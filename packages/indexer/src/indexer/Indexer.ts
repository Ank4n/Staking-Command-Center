import type { ApiPromise } from '@polkadot/api';
import type { Header, EventRecord } from '@polkadot/types/interfaces';
import type { Logger } from 'pino';
import type { StakingDatabase } from '../database';

export class Indexer {
  private apiRC: ApiPromise;
  private apiAH: ApiPromise;
  private db: StakingDatabase;
  private logger: Logger;
  private backfillBlocks: number;
  private isRunning: boolean = false;
  private unsubscribeRC: (() => void) | null = null;
  private unsubscribeAH: (() => void) | null = null;

  constructor(apiRC: ApiPromise, apiAH: ApiPromise, db: StakingDatabase, logger: Logger, backfillBlocks: number) {
    this.apiRC = apiRC;
    this.apiAH = apiAH;
    this.db = db;
    this.logger = logger.child({ component: 'Indexer' });
    this.backfillBlocks = backfillBlocks;
  }

  /**
   * Start indexing both chains
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Indexer already running');
      return;
    }

    this.logger.info('Starting indexer...');

    try {
      // Get current finalized blocks for both chains
      const finalizedHeadRC = await this.apiRC.rpc.chain.getFinalizedHead();
      const finalizedHeaderRC = await this.apiRC.rpc.chain.getHeader(finalizedHeadRC);
      const currentBlockRC = finalizedHeaderRC.number.toNumber();

      const finalizedHeadAH = await this.apiAH.rpc.chain.getFinalizedHead();
      const finalizedHeaderAH = await this.apiAH.rpc.chain.getHeader(finalizedHeadAH);
      const currentBlockAH = finalizedHeaderAH.number.toNumber();

      this.logger.info({ currentBlockRC, currentBlockAH }, 'Current finalized blocks');

      // Determine starting blocks for backfill
      const lastBlockRCStr = this.db.getState('lastProcessedBlockRC');
      const lastBlockAHStr = this.db.getState('lastProcessedBlockAH');

      let startBlockRC: number;
      let startBlockAH: number;

      if (lastBlockRCStr) {
        startBlockRC = parseInt(lastBlockRCStr, 10) + 1;
        this.logger.info({ lastBlock: parseInt(lastBlockRCStr, 10), startBlockRC }, 'Resuming Relay Chain from last processed block');
      } else {
        startBlockRC = Math.max(1, currentBlockRC - this.backfillBlocks);
        this.logger.info({ startBlockRC, blocksBack: this.backfillBlocks }, 'Initial start: backfilling Relay Chain');
      }

      if (lastBlockAHStr) {
        startBlockAH = parseInt(lastBlockAHStr, 10) + 1;
        this.logger.info({ lastBlock: parseInt(lastBlockAHStr, 10), startBlockAH }, 'Resuming Asset Hub from last processed block');
      } else {
        startBlockAH = Math.max(1, currentBlockAH - this.backfillBlocks);
        this.logger.info({ startBlockAH, blocksBack: this.backfillBlocks }, 'Initial start: backfilling Asset Hub');
      }

      // Process backfill for both chains in parallel
      await Promise.all([
        this.catchUpRC(startBlockRC, currentBlockRC),
        this.catchUpAH(startBlockAH, currentBlockAH),
      ]);

      // Subscribe to new finalized blocks for both chains
      this.isRunning = true;
      this.subscribeToNewBlocksRC();
      this.subscribeToNewBlocksAH();

      this.logger.info('Indexer started successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start indexer');
      throw error;
    }
  }

  /**
   * Catch up with missed blocks on Relay Chain
   */
  private async catchUpRC(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) {
      this.logger.info('Relay Chain already caught up');
      return;
    }

    const totalBlocks = toBlock - fromBlock + 1;
    this.logger.info({ fromBlock, toBlock, totalBlocks }, 'Catching up Relay Chain');

    for (let i = fromBlock; i <= toBlock; i++) {
      try {
        await this.processBlockByNumberRC(i);

        if ((i - fromBlock + 1) % 10 === 0 || i === toBlock) {
          const processed = i - fromBlock + 1;
          this.logger.info({
            processed,
            total: totalBlocks,
            progress: `${((processed / totalBlocks) * 100).toFixed(1)}%`,
            chain: 'RC'
          }, 'Relay Chain catch-up progress');
        }
      } catch (error) {
        this.logger.error({ error, blockNumber: i }, 'Error processing RC block during catch-up');
        // Continue with next block
      }
    }

    this.logger.info({ totalBlocks }, 'Relay Chain catch-up completed');
  }

  /**
   * Catch up with missed blocks on Asset Hub
   */
  private async catchUpAH(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) {
      this.logger.info('Asset Hub already caught up');
      return;
    }

    const totalBlocks = toBlock - fromBlock + 1;
    this.logger.info({ fromBlock, toBlock, totalBlocks }, 'Catching up Asset Hub');

    for (let i = fromBlock; i <= toBlock; i++) {
      try {
        await this.processBlockByNumberAH(i);

        if ((i - fromBlock + 1) % 10 === 0 || i === toBlock) {
          const processed = i - fromBlock + 1;
          this.logger.info({
            processed,
            total: totalBlocks,
            progress: `${((processed / totalBlocks) * 100).toFixed(1)}%`,
            chain: 'AH'
          }, 'Asset Hub catch-up progress');
        }
      } catch (error) {
        this.logger.error({ error, blockNumber: i }, 'Error processing AH block during catch-up');
        // Continue with next block
      }
    }

    this.logger.info({ totalBlocks }, 'Asset Hub catch-up completed');
  }

  /**
   * Subscribe to new finalized blocks on Relay Chain
   */
  private subscribeToNewBlocksRC(): void {
    this.logger.info('Subscribing to Relay Chain new finalized blocks');

    this.unsubscribeRC = this.apiRC.rpc.chain.subscribeFinalizedHeads(async (header: Header) => {
      const blockNumber = header.number.toNumber();

      try {
        await this.processBlockByNumberRC(blockNumber);
      } catch (error) {
        this.logger.error({ error, blockNumber, chain: 'RC' }, 'Error processing new RC block');
      }
    }) as unknown as () => void;
  }

  /**
   * Subscribe to new finalized blocks on Asset Hub
   */
  private subscribeToNewBlocksAH(): void {
    this.logger.info('Subscribing to Asset Hub new finalized blocks');

    this.unsubscribeAH = this.apiAH.rpc.chain.subscribeFinalizedHeads(async (header: Header) => {
      const blockNumber = header.number.toNumber();

      try {
        await this.processBlockByNumberAH(blockNumber);
      } catch (error) {
        this.logger.error({ error, blockNumber, chain: 'AH' }, 'Error processing new AH block');
      }
    }) as unknown as () => void;
  }

  /**
   * Process a Relay Chain block by its number
   */
  private async processBlockByNumberRC(blockNumber: number): Promise<void> {
    // Check if already processed
    const lastProcessed = this.db.getState('lastProcessedBlockRC');
    if (lastProcessed && parseInt(lastProcessed, 10) >= blockNumber) {
      return;
    }

    const blockHash = await this.apiRC.rpc.chain.getBlockHash(blockNumber);
    const header = await this.apiRC.rpc.chain.getHeader(blockHash);
    const apiAt = await this.apiRC.at(blockHash);

    // Get block timestamp
    const timestamp = await apiAt.query.timestamp.now();
    const blockTimestamp = (timestamp as any).toNumber();

    // Store block
    this.db.insertBlockRC({ blockNumber, timestamp: blockTimestamp });

    // Get and store events
    const eventsCodec = await apiAt.query.system.events();
    const events = eventsCodec as unknown as EventRecord[];

    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const record = events[eventIndex];
      const { event } = record;

      // Create event_id in format: blockNumber-eventIndex (for Subscan linking)
      const eventId = `${blockNumber}-${eventIndex}`;
      const eventType = `${event.section}.${event.method}`;

      this.db.insertEventRC({
        blockNumber,
        eventId,
        eventType,
        data: JSON.stringify(event.toHuman()),
      });
    }

    // Update last processed block
    this.db.setState('lastProcessedBlockRC', blockNumber.toString());

    this.logger.debug({ blockNumber, events: events.length }, 'Processed RC block');
  }

  /**
   * Process an Asset Hub block by its number
   */
  private async processBlockByNumberAH(blockNumber: number): Promise<void> {
    // Check if already processed
    const lastProcessed = this.db.getState('lastProcessedBlockAH');
    if (lastProcessed && parseInt(lastProcessed, 10) >= blockNumber) {
      return;
    }

    const blockHash = await this.apiAH.rpc.chain.getBlockHash(blockNumber);
    const header = await this.apiAH.rpc.chain.getHeader(blockHash);
    const apiAt = await this.apiAH.at(blockHash);

    // Get block timestamp
    const timestamp = await apiAt.query.timestamp.now();
    const blockTimestamp = (timestamp as any).toNumber();

    // Store block
    this.db.insertBlockAH({ blockNumber, timestamp: blockTimestamp });

    // Get and store events
    const eventsCodec = await apiAt.query.system.events();
    const events = eventsCodec as unknown as EventRecord[];

    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const record = events[eventIndex];
      const { event } = record;

      // Create event_id in format: blockNumber-eventIndex (for Subscan linking)
      const eventId = `${blockNumber}-${eventIndex}`;
      const eventType = `${event.section}.${event.method}`;

      this.db.insertEventAH({
        blockNumber,
        eventId,
        eventType,
        data: JSON.stringify(event.toHuman()),
      });

      // Process special events
      await this.processSpecialEvent(event, eventType, blockNumber, blockTimestamp);
    }

    // Update last processed block
    this.db.setState('lastProcessedBlockAH', blockNumber.toString());

    this.logger.debug({ blockNumber, events: events.length }, 'Processed AH block');
  }

  /**
   * Process special events that create sessions and eras
   */
  private async processSpecialEvent(event: any, eventType: string, blockNumber: number, blockTimestamp: number): Promise<void> {
    // Look for stakingRelaychainClient.SessionReportReceived event
    if (eventType === 'stakingRelaychainClient.SessionReportReceived') {
      await this.handleSessionReportReceived(event, blockNumber, blockTimestamp);
    }
  }

  /**
   * Handle SessionReportReceived event to create sessions and eras
   */
  private async handleSessionReportReceived(event: any, blockNumber: number, blockTimestamp: number): Promise<void> {
    try {
      // Parse event data
      const eventData = event.toJSON();

      // Extract fields from event
      // Based on https://assethub-kusama.subscan.io/event/11499278-10
      // Event structure: { endIndex, validatorSet: [...], totalPoints }
      const endIndex = event.data.endIndex ? event.data.endIndex.toNumber() : null;
      const totalPoints = event.data.totalPoints ? event.data.totalPoints.toNumber() : 0;

      if (endIndex === null) {
        this.logger.warn({ blockNumber, eventData }, 'SessionReportReceived missing endIndex');
        return;
      }

      const sessionId = endIndex;

      // Check if event has activation_timestamp (marks new era)
      // If activation_timestamp is present, this is an era boundary
      let activationTimestamp: number | null = null;
      let isEraStart = false;

      // Try to extract activation_timestamp from event data
      if (event.data.activationTimestamp) {
        activationTimestamp = event.data.activationTimestamp.toNumber();
        isEraStart = true;
      }

      this.logger.info({
        sessionId,
        blockNumber,
        totalPoints,
        activationTimestamp,
        isEraStart
      }, 'SessionReportReceived event');

      // If this is an era start, create/update era
      let eraId: number | null = null;
      if (isEraStart && activationTimestamp !== null) {
        // Query current era from Asset Hub
        const apiAt = await this.apiAH.at(await this.apiAH.rpc.chain.getBlockHash(blockNumber));
        const currentEraOption = await apiAt.query.staking?.currentEra?.();

        if (currentEraOption && !currentEraOption.isEmpty) {
          eraId = (currentEraOption as any).toNumber();

          // Update previous era's end session
          const previousEra = this.db.getLatestEra();
          if (previousEra && previousEra.sessionEnd === null) {
            this.db.upsertEra({
              ...previousEra,
              sessionEnd: sessionId - 1,
            });
          }

          // Create new era (sessionId and eraId are guaranteed to be numbers here)
          this.db.upsertEra({
            eraId: eraId!,
            sessionStart: (sessionId as number) + 1,
            sessionEnd: null,
            startTime: activationTimestamp,
          });

          this.logger.info({ eraId, sessionStart: sessionId + 1, startTime: activationTimestamp }, 'New era created');
        }
      }

      // Create/update session
      this.db.upsertSession({
        sessionId,
        blockNumber,
        activationTimestamp,
        eraId,
        validatorPointsTotal: totalPoints,
      });

      this.logger.info({ sessionId, eraId, totalPoints }, 'Session created/updated');

    } catch (error) {
      this.logger.error({ error, blockNumber, eventType: 'SessionReportReceived' }, 'Error handling SessionReportReceived');
    }
  }

  /**
   * Stop indexing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping indexer...');

    if (this.unsubscribeRC) {
      this.unsubscribeRC();
      this.unsubscribeRC = null;
    }

    if (this.unsubscribeAH) {
      this.unsubscribeAH();
      this.unsubscribeAH = null;
    }

    this.isRunning = false;
    this.logger.info('Indexer stopped');
  }

  /**
   * Check if indexer is running
   */
  isIndexing(): boolean {
    return this.isRunning;
  }
}
