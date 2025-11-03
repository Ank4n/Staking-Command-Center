import type { ApiPromise } from '@polkadot/api';
import type { EventRecord } from '@polkadot/types/interfaces';
import type { Logger } from 'pino';
import type { StakingDatabase } from '../database';
import type { ElectionPhase, Warning } from '@staking-cc/shared';

export class EventProcessor {
  private api: ApiPromise;
  private db: StakingDatabase;
  private logger: Logger;
  private currentEra: number | null = null;
  private currentSession: number | null = null;
  private currentElectionPhase: ElectionPhase | null = null;

  constructor(api: ApiPromise, db: StakingDatabase, logger: Logger) {
    this.api = api;
    this.db = db;
    this.logger = logger.child({ component: 'EventProcessor' });
  }

  /**
   * Process events from a block
   */
  async processBlockEvents(
    blockNumber: number,
    blockHash: string,
    events: EventRecord[],
    blockTimestamp: number
  ): Promise<void> {
    for (const record of events) {
      const { event } = record;
      const eventType = `${event.section}.${event.method}`;

      try {
        // Store raw event for debugging
        this.db.insertEvent({
          blockNumber,
          eraIndex: this.currentEra,
          sessionIndex: this.currentSession,
          eventType,
          data: JSON.stringify(event.toHuman()),
          timestamp: blockTimestamp,
        });

        // Process specific events
        switch (eventType) {
          case 'session.NewSession':
            await this.handleNewSession(blockNumber, blockTimestamp, event);
            break;

          case 'staking.EraPaid':
            await this.handleEraPaid(blockNumber, event);
            break;

          case 'staking.Rewarded':
            // Track individual rewards
            break;

          case 'staking.Slashed':
            await this.handleSlash(blockNumber, blockTimestamp, event);
            break;

          case 'electionProviderMultiPhase.PhaseTransitioned':
            await this.handlePhaseTransition(blockNumber, blockTimestamp, event);
            break;

          case 'electionProviderMultiPhase.ElectionFinalized':
            await this.handleElectionFinalized(blockNumber, blockTimestamp);
            break;

          case 'staking.StakingElectionFailed':
            await this.handleElectionFailed(blockNumber, blockTimestamp);
            break;

          default:
            // Log other staking/election related events
            if (
              event.section === 'staking' ||
              event.section === 'session' ||
              event.section === 'electionProviderMultiPhase'
            ) {
              this.logger.debug({ eventType, blockNumber }, 'Staking-related event');
            }
        }
      } catch (error) {
        this.logger.error({ error, eventType, blockNumber }, 'Error processing event');
      }
    }
  }

  /**
   * Handle new session event
   */
  private async handleNewSession(blockNumber: number, blockTimestamp: number, event: any): Promise<void> {
    const sessionIndex = event.data[0].toNumber();
    this.currentSession = sessionIndex;

    this.logger.info({ sessionIndex, blockNumber }, 'New session started');

    // Get era info
    const activeEra = await this.api.query.staking.activeEra();
    const activeEraInfo = (activeEra as any).unwrapOrDefault();
    const eraIndex = (activeEraInfo.index as any).toNumber();

    if (eraIndex !== this.currentEra) {
      // New era started
      await this.handleNewEra(eraIndex, sessionIndex, blockTimestamp);
    }

    // Get validator count
    const validators = await this.api.query.session.validators();
    const validatorCount = (validators as any).length;

    // Store session info
    this.db.upsertSession({
      sessionIndex,
      eraIndex,
      startBlock: blockNumber,
      startTime: blockTimestamp,
      validatorCount,
      pointsTotal: null,
    });

    // Check for timing warnings
    await this.checkSessionTiming(sessionIndex);
  }

  /**
   * Handle new era
   */
  private async handleNewEra(eraIndex: number, sessionIndex: number, blockTimestamp: number): Promise<void> {
    this.logger.info({ eraIndex, sessionIndex }, 'New era started');

    // Complete previous era
    if (this.currentEra !== null) {
      const prevEra = this.db.getEra(this.currentEra);
      if (prevEra && !prevEra.endTime) {
        this.db.upsertEra({
          ...prevEra,
          endSession: sessionIndex - 1,
          endTime: blockTimestamp,
        });
      }
    }

    this.currentEra = eraIndex;

    // Get validator and nominator counts
    const validators = await this.api.query.staking.validators.keys();
    const nominators = await this.api.query.staking.nominators.keys();

    // Create new era record
    this.db.upsertEra({
      eraIndex,
      startSession: sessionIndex,
      endSession: null,
      startTime: blockTimestamp,
      endTime: null,
      totalValidators: validators.length,
      totalNominators: nominators.length,
      inflationAmount: null,
    });

    // Prune old eras
    this.db.pruneOldEras();
  }

  /**
   * Handle era paid event
   */
  private async handleEraPaid(blockNumber: number, event: any): Promise<void> {
    const eraIndex = event.data[0].toNumber();
    const validatorPayout = event.data[1].toString();
    const remainder = event.data[2]?.toString() || '0';

    const totalInflation = (BigInt(validatorPayout) + BigInt(remainder)).toString();

    this.logger.info({ eraIndex, totalInflation }, 'Era paid');

    // Update era with inflation amount
    const era = this.db.getEra(eraIndex);
    if (era) {
      this.db.upsertEra({
        ...era,
        inflationAmount: totalInflation,
      });
    }
  }

  /**
   * Handle slash event
   */
  private async handleSlash(blockNumber: number, blockTimestamp: number, event: any): Promise<void> {
    const validator = event.data[0].toString();
    const amount = event.data[1].toString();

    this.logger.warn({ validator, amount, blockNumber }, 'Validator slashed');

    this.db.insertWarning({
      eraIndex: this.currentEra,
      sessionIndex: this.currentSession,
      blockNumber,
      type: 'unexpected_event',
      message: `Validator ${validator} slashed for ${amount}`,
      severity: 'error',
      timestamp: blockTimestamp,
    });
  }

  /**
   * Handle election phase transition
   */
  private async handlePhaseTransition(blockNumber: number, blockTimestamp: number, event: any): Promise<void> {
    const fromPhase = event.data[0].toString().toLowerCase() as ElectionPhase;
    const toPhase = event.data[1].toString().toLowerCase() as ElectionPhase;

    this.logger.info({ fromPhase, toPhase, blockNumber }, 'Election phase transition');

    // Close previous phase
    if (this.currentEra !== null && fromPhase !== 'off') {
      const activePhase = this.db.getActiveElectionPhase(this.currentEra);
      if (activePhase) {
        this.db.updateElectionPhaseEnd(activePhase.id!, blockNumber, blockTimestamp);
      }
    }

    // Start new phase
    if (this.currentEra !== null && toPhase !== 'off') {
      this.db.insertElectionPhase({
        eraIndex: this.currentEra,
        phase: toPhase,
        startBlock: blockNumber,
        endBlock: null,
        startTime: blockTimestamp,
        endTime: null,
      });
    }

    this.currentElectionPhase = toPhase;
  }

  /**
   * Handle election finalized
   */
  private async handleElectionFinalized(blockNumber: number, blockTimestamp: number): Promise<void> {
    this.logger.info({ blockNumber }, 'Election finalized');

    // This marks the end of the election process
    if (this.currentEra !== null) {
      const activePhase = this.db.getActiveElectionPhase(this.currentEra);
      if (activePhase) {
        this.db.updateElectionPhaseEnd(activePhase.id!, blockNumber, blockTimestamp);
      }
    }
  }

  /**
   * Handle election failed
   */
  private async handleElectionFailed(blockNumber: number, blockTimestamp: number): Promise<void> {
    this.logger.error({ blockNumber }, 'Staking election failed!');

    this.db.insertWarning({
      eraIndex: this.currentEra,
      sessionIndex: this.currentSession,
      blockNumber,
      type: 'election_issue',
      message: 'Staking election failed',
      severity: 'error',
      timestamp: blockTimestamp,
    });
  }

  /**
   * Check for session timing warnings
   */
  private async checkSessionTiming(sessionIndex: number): Promise<void> {
    if (sessionIndex < 2) return;

    const currentSession = this.db.getSession(sessionIndex);
    const previousSession = this.db.getSession(sessionIndex - 1);

    if (!currentSession || !previousSession) return;

    const sessionDuration = currentSession.startTime - previousSession.startTime;
    const EXPECTED_SESSION_DURATION = 3600000; // 1 hour in ms
    const TOLERANCE = 0.2; // 20% tolerance

    if (
      sessionDuration < EXPECTED_SESSION_DURATION * (1 - TOLERANCE) ||
      sessionDuration > EXPECTED_SESSION_DURATION * (1 + TOLERANCE)
    ) {
      this.db.insertWarning({
        eraIndex: this.currentEra,
        sessionIndex,
        blockNumber: currentSession.startBlock,
        type: 'timing',
        message: `Session duration ${Math.round(sessionDuration / 1000)}s is outside expected range`,
        severity: 'warning',
        timestamp: currentSession.startTime,
      });
    }
  }

  /**
   * Update current state from chain
   */
  async syncState(): Promise<void> {
    try {
      const activeEra = await this.api.query.staking.activeEra();
      const activeEraInfo = (activeEra as any).unwrapOrDefault();
      this.currentEra = (activeEraInfo.index as any).toNumber();

      const currentSession = await this.api.query.session.currentIndex();
      this.currentSession = (currentSession as any).toNumber();

      const phase = await this.api.query.electionProviderMultiPhase.currentPhase();
      this.currentElectionPhase = phase.toString().toLowerCase() as ElectionPhase;

      this.logger.info(
        { era: this.currentEra, session: this.currentSession, phase: this.currentElectionPhase },
        'State synced'
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to sync state');
    }
  }
}
