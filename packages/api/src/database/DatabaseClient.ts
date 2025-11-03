import Database from 'better-sqlite3';
import type {
  Era,
  Session,
  ElectionPhaseRecord,
  ValidatorPoints,
  Warning,
  BlockchainEvent,
  ApiStatus,
  EraDetails,
} from '@staking-cc/shared';

export class DatabaseClient {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    this.db.pragma('query_only = ON');
  }

  // ===== STATUS =====

  getStatus(): ApiStatus {
    const lastBlock = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?').get('lastProcessedBlock') as { value: string } | undefined;

    const latestEra = this.db.prepare('SELECT * FROM eras ORDER BY era_index DESC LIMIT 1').get() as Era | undefined;
    const latestSession = this.db.prepare('SELECT * FROM sessions ORDER BY session_index DESC LIMIT 1').get() as Session | undefined;

    const activePhase = latestEra
      ? (this.db.prepare('SELECT * FROM election_phases WHERE era_index = ? AND end_block IS NULL ORDER BY start_block DESC LIMIT 1').get(latestEra.eraIndex) as ElectionPhaseRecord | undefined)
      : undefined;

    return {
      chain: process.env.CHAIN as any,
      currentEra: latestEra?.eraIndex || null,
      currentSession: latestSession?.sessionIndex || null,
      activeValidators: latestSession?.validatorCount || null,
      electionPhase: activePhase?.phase || null,
      lastBlock: lastBlock ? parseInt(lastBlock.value, 10) : 0,
      lastUpdateTime: latestSession?.startTime || Date.now(),
      rpcEndpoint: 'N/A',
      isConnected: true,
    };
  }

  // ===== ERAS =====

  getEras(limit: number = 100): Era[] {
    return this.db
      .prepare('SELECT * FROM eras ORDER BY era_index DESC LIMIT ?')
      .all(limit) as Era[];
  }

  getEra(eraIndex: number): EraDetails | null {
    const era = this.db.prepare('SELECT * FROM eras WHERE era_index = ?').get(eraIndex) as Era | undefined;

    if (!era) {
      return null;
    }

    const sessions = this.db
      .prepare('SELECT * FROM sessions WHERE era_index = ? ORDER BY session_index')
      .all(eraIndex) as Session[];

    const electionPhases = this.db
      .prepare('SELECT * FROM election_phases WHERE era_index = ? ORDER BY start_block')
      .all(eraIndex) as ElectionPhaseRecord[];

    const warnings = this.db
      .prepare('SELECT * FROM warnings WHERE era_index = ? ORDER BY timestamp DESC')
      .all(eraIndex) as Warning[];

    return {
      ...era,
      sessions,
      electionPhases,
      warnings,
    };
  }

  // ===== SESSIONS =====

  getSession(sessionIndex: number): Session | null {
    return this.db
      .prepare('SELECT * FROM sessions WHERE session_index = ?')
      .get(sessionIndex) as Session | undefined || null;
  }

  getSessionsByEra(eraIndex: number): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE era_index = ? ORDER BY session_index')
      .all(eraIndex) as Session[];
  }

  // ===== ELECTION PHASES =====

  getElectionPhases(eraIndex: number): ElectionPhaseRecord[] {
    return this.db
      .prepare('SELECT * FROM election_phases WHERE era_index = ? ORDER BY start_block')
      .all(eraIndex) as ElectionPhaseRecord[];
  }

  getCurrentElectionPhase(): ElectionPhaseRecord | null {
    const latestEra = this.db.prepare('SELECT era_index FROM eras ORDER BY era_index DESC LIMIT 1').get() as { era_index: number } | undefined;

    if (!latestEra) {
      return null;
    }

    return this.db
      .prepare('SELECT * FROM election_phases WHERE era_index = ? AND end_block IS NULL ORDER BY start_block DESC LIMIT 1')
      .get(latestEra.era_index) as ElectionPhaseRecord | undefined || null;
  }

  // ===== VALIDATOR POINTS =====

  getValidatorPointsBySession(sessionIndex: number): ValidatorPoints[] {
    return this.db
      .prepare('SELECT * FROM validator_points WHERE session_index = ? ORDER BY points DESC')
      .all(sessionIndex) as ValidatorPoints[];
  }

  getValidatorPointsByAddress(validatorAddress: string, limit: number = 10): ValidatorPoints[] {
    return this.db
      .prepare('SELECT * FROM validator_points WHERE validator_address = ? ORDER BY session_index DESC LIMIT ?')
      .all(validatorAddress, limit) as ValidatorPoints[];
  }

  // ===== WARNINGS =====

  getWarnings(limit: number = 100): Warning[] {
    return this.db
      .prepare('SELECT * FROM warnings ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Warning[];
  }

  getWarningsByEra(eraIndex: number): Warning[] {
    return this.db
      .prepare('SELECT * FROM warnings WHERE era_index = ? ORDER BY timestamp DESC')
      .all(eraIndex) as Warning[];
  }

  getWarningsBySeverity(severity: string, limit: number = 100): Warning[] {
    return this.db
      .prepare('SELECT * FROM warnings WHERE severity = ? ORDER BY timestamp DESC LIMIT ?')
      .all(severity, limit) as Warning[];
  }

  // ===== EVENTS =====

  getEvents(limit: number = 100): BlockchainEvent[] {
    return this.db
      .prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as BlockchainEvent[];
  }

  getEventsByType(eventType: string, limit: number = 100): BlockchainEvent[] {
    return this.db
      .prepare('SELECT * FROM events WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?')
      .all(eventType, limit) as BlockchainEvent[];
  }

  getEventsByBlock(blockNumber: number): BlockchainEvent[] {
    return this.db
      .prepare('SELECT * FROM events WHERE block_number = ? ORDER BY id')
      .all(blockNumber) as BlockchainEvent[];
  }

  // ===== STATS =====

  getStats() {
    const eraCount = this.db.prepare('SELECT COUNT(*) as count FROM eras').get() as { count: number };
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const warningCount = this.db.prepare('SELECT COUNT(*) as count FROM warnings').get() as { count: number };
    const eventCount = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };

    return {
      eras: eraCount.count,
      sessions: sessionCount.count,
      warnings: warningCount.count,
      events: eventCount.count,
    };
  }

  close(): void {
    this.db.close();
  }
}
