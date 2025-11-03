import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type {
  Era,
  Session,
  ElectionPhaseRecord,
  ValidatorPoints,
  Warning,
  BlockchainEvent,
} from '@staking-cc/shared';

export class StakingDatabase {
  private db: Database.Database;
  private logger: Logger;
  private maxEras: number;

  constructor(dbPath: string, logger: Logger, maxEras: number = 100) {
    this.logger = logger.child({ component: 'Database' });
    this.maxEras = maxEras;

    this.logger.info(`Opening database at ${dbPath}`);
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.logger.info('Initializing database schema');

    this.db.exec(`
      -- Eras table
      CREATE TABLE IF NOT EXISTS eras (
        era_index INTEGER PRIMARY KEY,
        start_session INTEGER,
        end_session INTEGER,
        start_time INTEGER,
        end_time INTEGER,
        total_validators INTEGER,
        total_nominators INTEGER,
        inflation_amount TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_eras_start_time ON eras(start_time);
      CREATE INDEX IF NOT EXISTS idx_eras_end_time ON eras(end_time);

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        session_index INTEGER PRIMARY KEY,
        era_index INTEGER,
        start_block INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        validator_count INTEGER,
        points_total INTEGER,
        FOREIGN KEY (era_index) REFERENCES eras(era_index) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_era ON sessions(era_index);
      CREATE INDEX IF NOT EXISTS idx_sessions_start_block ON sessions(start_block);

      -- Election phases table
      CREATE TABLE IF NOT EXISTS election_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        era_index INTEGER NOT NULL,
        phase TEXT NOT NULL,
        start_block INTEGER NOT NULL,
        end_block INTEGER,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        FOREIGN KEY (era_index) REFERENCES eras(era_index) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_election_phases_era ON election_phases(era_index);
      CREATE INDEX IF NOT EXISTS idx_election_phases_phase ON election_phases(phase);
      CREATE INDEX IF NOT EXISTS idx_election_phases_start_block ON election_phases(start_block);

      -- Validator points table
      CREATE TABLE IF NOT EXISTS validator_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_index INTEGER NOT NULL,
        validator_address TEXT NOT NULL,
        points INTEGER NOT NULL,
        FOREIGN KEY (session_index) REFERENCES sessions(session_index) ON DELETE CASCADE,
        UNIQUE(session_index, validator_address)
      );

      CREATE INDEX IF NOT EXISTS idx_validator_points_session ON validator_points(session_index);
      CREATE INDEX IF NOT EXISTS idx_validator_points_validator ON validator_points(validator_address);

      -- Warnings table
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        era_index INTEGER,
        session_index INTEGER,
        block_number INTEGER NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (era_index) REFERENCES eras(era_index) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_warnings_era ON warnings(era_index);
      CREATE INDEX IF NOT EXISTS idx_warnings_session ON warnings(session_index);
      CREATE INDEX IF NOT EXISTS idx_warnings_timestamp ON warnings(timestamp);
      CREATE INDEX IF NOT EXISTS idx_warnings_severity ON warnings(severity);

      -- Events table (for debugging and audit trail)
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_number INTEGER NOT NULL,
        era_index INTEGER,
        session_index INTEGER,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_block ON events(block_number);
      CREATE INDEX IF NOT EXISTS idx_events_era ON events(era_index);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

      -- Indexer state table (for tracking sync progress)
      CREATE TABLE IF NOT EXISTS indexer_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.logger.info('Database schema initialized');
  }

  // ===== ERA METHODS =====

  upsertEra(era: Era): void {
    const stmt = this.db.prepare(`
      INSERT INTO eras (
        era_index, start_session, end_session, start_time, end_time,
        total_validators, total_nominators, inflation_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(era_index) DO UPDATE SET
        start_session = COALESCE(excluded.start_session, start_session),
        end_session = COALESCE(excluded.end_session, end_session),
        start_time = COALESCE(excluded.start_time, start_time),
        end_time = COALESCE(excluded.end_time, end_time),
        total_validators = COALESCE(excluded.total_validators, total_validators),
        total_nominators = COALESCE(excluded.total_nominators, total_nominators),
        inflation_amount = COALESCE(excluded.inflation_amount, inflation_amount)
    `);

    stmt.run(
      era.eraIndex,
      era.startSession,
      era.endSession,
      era.startTime,
      era.endTime,
      era.totalValidators,
      era.totalNominators,
      era.inflationAmount
    );
  }

  getEra(eraIndex: number): Era | null {
    const stmt = this.db.prepare('SELECT * FROM eras WHERE era_index = ?');
    return stmt.get(eraIndex) as Era | null;
  }

  getLatestEra(): Era | null {
    const stmt = this.db.prepare('SELECT * FROM eras ORDER BY era_index DESC LIMIT 1');
    return stmt.get() as Era | null;
  }

  getRecentEras(limit: number = 100): Era[] {
    const stmt = this.db.prepare('SELECT * FROM eras ORDER BY era_index DESC LIMIT ?');
    return stmt.all(limit) as Era[];
  }

  // ===== SESSION METHODS =====

  upsertSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        session_index, era_index, start_block, start_time,
        validator_count, points_total
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_index) DO UPDATE SET
        era_index = COALESCE(excluded.era_index, era_index),
        validator_count = COALESCE(excluded.validator_count, validator_count),
        points_total = COALESCE(excluded.points_total, points_total)
    `);

    stmt.run(
      session.sessionIndex,
      session.eraIndex,
      session.startBlock,
      session.startTime,
      session.validatorCount,
      session.pointsTotal
    );
  }

  getSession(sessionIndex: number): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_index = ?');
    return stmt.get(sessionIndex) as Session | null;
  }

  getLatestSession(): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY session_index DESC LIMIT 1');
    return stmt.get() as Session | null;
  }

  getSessionsByEra(eraIndex: number): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE era_index = ? ORDER BY session_index');
    return stmt.all(eraIndex) as Session[];
  }

  // ===== ELECTION PHASE METHODS =====

  insertElectionPhase(phase: ElectionPhaseRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO election_phases (
        era_index, phase, start_block, end_block, start_time, end_time
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      phase.eraIndex,
      phase.phase,
      phase.startBlock,
      phase.endBlock,
      phase.startTime,
      phase.endTime
    );

    return result.lastInsertRowid as number;
  }

  updateElectionPhaseEnd(id: number, endBlock: number, endTime: number): void {
    const stmt = this.db.prepare(`
      UPDATE election_phases
      SET end_block = ?, end_time = ?
      WHERE id = ?
    `);

    stmt.run(endBlock, endTime, id);
  }

  getActiveElectionPhase(eraIndex: number): ElectionPhaseRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM election_phases
      WHERE era_index = ? AND end_block IS NULL
      ORDER BY start_block DESC
      LIMIT 1
    `);

    return stmt.get(eraIndex) as ElectionPhaseRecord | null;
  }

  getElectionPhasesByEra(eraIndex: number): ElectionPhaseRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM election_phases
      WHERE era_index = ?
      ORDER BY start_block
    `);

    return stmt.all(eraIndex) as ElectionPhaseRecord[];
  }

  // ===== VALIDATOR POINTS METHODS =====

  upsertValidatorPoints(points: ValidatorPoints): void {
    const stmt = this.db.prepare(`
      INSERT INTO validator_points (session_index, validator_address, points)
      VALUES (?, ?, ?)
      ON CONFLICT(session_index, validator_address) DO UPDATE SET
        points = excluded.points
    `);

    stmt.run(points.sessionIndex, points.validatorAddress, points.points);
  }

  batchUpsertValidatorPoints(pointsList: ValidatorPoints[]): void {
    const insert = this.db.prepare(`
      INSERT INTO validator_points (session_index, validator_address, points)
      VALUES (?, ?, ?)
      ON CONFLICT(session_index, validator_address) DO UPDATE SET
        points = excluded.points
    `);

    const insertMany = this.db.transaction((points: ValidatorPoints[]) => {
      for (const point of points) {
        insert.run(point.sessionIndex, point.validatorAddress, point.points);
      }
    });

    insertMany(pointsList);
  }

  getValidatorPointsBySession(sessionIndex: number): ValidatorPoints[] {
    const stmt = this.db.prepare(`
      SELECT * FROM validator_points
      WHERE session_index = ?
      ORDER BY points DESC
    `);

    return stmt.all(sessionIndex) as ValidatorPoints[];
  }

  getValidatorPointsByAddress(validatorAddress: string, limit: number = 10): ValidatorPoints[] {
    const stmt = this.db.prepare(`
      SELECT * FROM validator_points
      WHERE validator_address = ?
      ORDER BY session_index DESC
      LIMIT ?
    `);

    return stmt.all(validatorAddress, limit) as ValidatorPoints[];
  }

  // ===== WARNING METHODS =====

  insertWarning(warning: Warning): number {
    const stmt = this.db.prepare(`
      INSERT INTO warnings (
        era_index, session_index, block_number, type, message, severity, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      warning.eraIndex,
      warning.sessionIndex,
      warning.blockNumber,
      warning.type,
      warning.message,
      warning.severity,
      warning.timestamp
    );

    return result.lastInsertRowid as number;
  }

  getWarningsByEra(eraIndex: number): Warning[] {
    const stmt = this.db.prepare(`
      SELECT * FROM warnings
      WHERE era_index = ?
      ORDER BY timestamp DESC
    `);

    return stmt.all(eraIndex) as Warning[];
  }

  getRecentWarnings(limit: number = 100): Warning[] {
    const stmt = this.db.prepare(`
      SELECT * FROM warnings
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Warning[];
  }

  // ===== EVENT METHODS =====

  insertEvent(event: BlockchainEvent): number {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        block_number, era_index, session_index, event_type, data, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      event.blockNumber,
      event.eraIndex,
      event.sessionIndex,
      event.eventType,
      event.data,
      event.timestamp
    );

    return result.lastInsertRowid as number;
  }

  getEventsByBlock(blockNumber: number): BlockchainEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE block_number = ?
      ORDER BY id
    `);

    return stmt.all(blockNumber) as BlockchainEvent[];
  }

  getEventsByType(eventType: string, limit: number = 100): BlockchainEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE event_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(eventType, limit) as BlockchainEvent[];
  }

  // ===== INDEXER STATE METHODS =====

  setState(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO indexer_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    stmt.run(key, value, Date.now());
  }

  getState(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  // ===== MAINTENANCE METHODS =====

  /**
   * Prune old eras beyond the configured maximum
   */
  pruneOldEras(): number {
    const latestEra = this.getLatestEra();
    if (!latestEra) {
      return 0;
    }

    const cutoffEra = latestEra.eraIndex - this.maxEras;

    const stmt = this.db.prepare('DELETE FROM eras WHERE era_index < ?');
    const result = stmt.run(cutoffEra);

    if (result.changes > 0) {
      this.logger.info({ cutoffEra, deleted: result.changes }, 'Pruned old eras');
    }

    return result.changes;
  }

  /**
   * Get database statistics
   */
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

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('Database closed');
  }
}
