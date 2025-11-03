import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type {
  Era,
  Session,
  Block,
  BlockchainEvent,
  Warning,
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
   * Initialize database schema with new simplified design
   */
  private initialize(): void {
    this.logger.info('Initializing database schema');

    this.db.exec(`
      -- Blocks table for Relay Chain
      CREATE TABLE IF NOT EXISTS blocks_rc (
        block_number INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_rc_timestamp ON blocks_rc(timestamp);

      -- Blocks table for Asset Hub
      CREATE TABLE IF NOT EXISTS blocks_ah (
        block_number INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_ah_timestamp ON blocks_ah(timestamp);

      -- Events table for Relay Chain
      CREATE TABLE IF NOT EXISTS events_rc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_number INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (block_number) REFERENCES blocks_rc(block_number) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_rc_block ON events_rc(block_number);
      CREATE INDEX IF NOT EXISTS idx_events_rc_type ON events_rc(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_rc_event_id ON events_rc(event_id);

      -- Events table for Asset Hub
      CREATE TABLE IF NOT EXISTS events_ah (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_number INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (block_number) REFERENCES blocks_ah(block_number) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_ah_block ON events_ah(block_number);
      CREATE INDEX IF NOT EXISTS idx_events_ah_type ON events_ah(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_ah_event_id ON events_ah(event_id);

      -- Sessions table (Asset Hub only)
      -- Created from stakingRelaychainClient.SessionReportReceived events
      CREATE TABLE IF NOT EXISTS sessions (
        session_id INTEGER PRIMARY KEY,
        block_number INTEGER NOT NULL,
        activation_timestamp INTEGER,
        era_id INTEGER,
        validator_points_total INTEGER NOT NULL,
        FOREIGN KEY (block_number) REFERENCES blocks_ah(block_number) ON DELETE CASCADE,
        FOREIGN KEY (era_id) REFERENCES eras(era_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_block ON sessions(block_number);
      CREATE INDEX IF NOT EXISTS idx_sessions_era ON sessions(era_id);

      -- Eras table
      -- Created from stakingRelaychainClient.SessionReportReceived events with activation_timestamp
      CREATE TABLE IF NOT EXISTS eras (
        era_id INTEGER PRIMARY KEY,
        session_start INTEGER NOT NULL,
        session_end INTEGER,
        start_time INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_eras_session_start ON eras(session_start);
      CREATE INDEX IF NOT EXISTS idx_eras_start_time ON eras(start_time);

      -- Warnings table (for future use)
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        era_id INTEGER,
        session_id INTEGER,
        block_number INTEGER NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (era_id) REFERENCES eras(era_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_warnings_era ON warnings(era_id);
      CREATE INDEX IF NOT EXISTS idx_warnings_session ON warnings(session_id);
      CREATE INDEX IF NOT EXISTS idx_warnings_timestamp ON warnings(timestamp);
      CREATE INDEX IF NOT EXISTS idx_warnings_severity ON warnings(severity);

      -- Indexer state table (for tracking sync progress)
      CREATE TABLE IF NOT EXISTS indexer_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.logger.info('Database schema initialized');
  }

  // ===== BLOCK METHODS =====

  insertBlockRC(block: Block): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO blocks_rc (block_number, timestamp)
      VALUES (?, ?)
    `);
    stmt.run(block.blockNumber, block.timestamp);
  }

  insertBlockAH(block: Block): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO blocks_ah (block_number, timestamp)
      VALUES (?, ?)
    `);
    stmt.run(block.blockNumber, block.timestamp);
  }

  getBlockRC(blockNumber: number): Block | null {
    const stmt = this.db.prepare('SELECT * FROM blocks_rc WHERE block_number = ?');
    const row = stmt.get(blockNumber) as any;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  getBlockAH(blockNumber: number): Block | null {
    const stmt = this.db.prepare('SELECT * FROM blocks_ah WHERE block_number = ?');
    const row = stmt.get(blockNumber) as any;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  getLatestBlockRC(): Block | null {
    const stmt = this.db.prepare('SELECT * FROM blocks_rc ORDER BY block_number DESC LIMIT 1');
    const row = stmt.get() as any;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  getLatestBlockAH(): Block | null {
    const stmt = this.db.prepare('SELECT * FROM blocks_ah ORDER BY block_number DESC LIMIT 1');
    const row = stmt.get() as any;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  getAllBlocksRC(limit: number = 100): Block[] {
    const stmt = this.db.prepare('SELECT * FROM blocks_rc ORDER BY block_number DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({ blockNumber: row.block_number, timestamp: row.timestamp }));
  }

  getAllBlocksAH(limit: number = 100): Block[] {
    const stmt = this.db.prepare('SELECT * FROM blocks_ah ORDER BY block_number DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({ blockNumber: row.block_number, timestamp: row.timestamp }));
  }

  // ===== EVENT METHODS =====

  insertEventRC(event: BlockchainEvent): number {
    const stmt = this.db.prepare(`
      INSERT INTO events_rc (block_number, event_id, event_type, data)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(event.blockNumber, event.eventId, event.eventType, event.data);
    return result.lastInsertRowid as number;
  }

  insertEventAH(event: BlockchainEvent): number {
    const stmt = this.db.prepare(`
      INSERT INTO events_ah (block_number, event_id, event_type, data)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(event.blockNumber, event.eventId, event.eventType, event.data);
    return result.lastInsertRowid as number;
  }

  getEventsByBlockRC(blockNumber: number): BlockchainEvent[] {
    const stmt = this.db.prepare('SELECT * FROM events_rc WHERE block_number = ? ORDER BY id');
    const rows = stmt.all(blockNumber) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByBlockAH(blockNumber: number): BlockchainEvent[] {
    const stmt = this.db.prepare('SELECT * FROM events_ah WHERE block_number = ? ORDER BY id');
    const rows = stmt.all(blockNumber) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByTypeAH(eventType: string, limit: number = 100): BlockchainEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events_ah
      WHERE event_type = ?
      ORDER BY block_number DESC
      LIMIT ?
    `);
    const rows = stmt.all(eventType, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getAllEventsRC(limit: number = 1000): BlockchainEvent[] {
    const stmt = this.db.prepare('SELECT * FROM events_rc ORDER BY block_number DESC, id DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getAllEventsAH(limit: number = 1000): BlockchainEvent[] {
    const stmt = this.db.prepare('SELECT * FROM events_ah ORDER BY block_number DESC, id DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  // ===== SESSION METHODS =====

  upsertSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id, block_number, activation_timestamp, era_id, validator_points_total
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        block_number = excluded.block_number,
        activation_timestamp = COALESCE(excluded.activation_timestamp, activation_timestamp),
        era_id = COALESCE(excluded.era_id, era_id),
        validator_points_total = excluded.validator_points_total
    `);

    stmt.run(
      session.sessionId,
      session.blockNumber,
      session.activationTimestamp,
      session.eraId,
      session.validatorPointsTotal
    );
  }

  getSession(sessionId: number): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const row = stmt.get(sessionId) as any;
    return row ? {
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      eraId: row.era_id,
      validatorPointsTotal: row.validator_points_total,
    } : null;
  }

  getLatestSession(): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY session_id DESC LIMIT 1');
    const row = stmt.get() as any;
    return row ? {
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      eraId: row.era_id,
      validatorPointsTotal: row.validator_points_total,
    } : null;
  }

  getSessionsByEra(eraId: number): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE era_id = ? ORDER BY session_id');
    const rows = stmt.all(eraId) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      eraId: row.era_id,
      validatorPointsTotal: row.validator_points_total,
    }));
  }

  getAllSessions(limit: number = 100): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY session_id DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      eraId: row.era_id,
      validatorPointsTotal: row.validator_points_total,
    }));
  }

  // ===== ERA METHODS =====

  upsertEra(era: Era): void {
    const stmt = this.db.prepare(`
      INSERT INTO eras (era_id, session_start, session_end, start_time)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(era_id) DO UPDATE SET
        session_start = excluded.session_start,
        session_end = COALESCE(excluded.session_end, session_end),
        start_time = excluded.start_time
    `);

    stmt.run(era.eraId, era.sessionStart, era.sessionEnd, era.startTime);
  }

  getEra(eraId: number): Era | null {
    const stmt = this.db.prepare('SELECT * FROM eras WHERE era_id = ?');
    const row = stmt.get(eraId) as any;
    return row ? {
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
    } : null;
  }

  getLatestEra(): Era | null {
    const stmt = this.db.prepare('SELECT * FROM eras ORDER BY era_id DESC LIMIT 1');
    const row = stmt.get() as any;
    return row ? {
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
    } : null;
  }

  getRecentEras(limit: number = 100): Era[] {
    const stmt = this.db.prepare('SELECT * FROM eras ORDER BY era_id DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
    }));
  }

  // ===== WARNING METHODS =====

  insertWarning(warning: Warning): number {
    const stmt = this.db.prepare(`
      INSERT INTO warnings (
        era_id, session_id, block_number, type, message, severity, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      warning.eraId,
      warning.sessionId,
      warning.blockNumber,
      warning.type,
      warning.message,
      warning.severity,
      warning.timestamp
    );

    return result.lastInsertRowid as number;
  }

  getWarningsByEra(eraId: number): Warning[] {
    const stmt = this.db.prepare(`
      SELECT * FROM warnings
      WHERE era_id = ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(eraId) as any[];
    return rows.map(row => ({
      id: row.id,
      eraId: row.era_id,
      sessionId: row.session_id,
      blockNumber: row.block_number,
      type: row.type,
      message: row.message,
      severity: row.severity,
      timestamp: row.timestamp,
    }));
  }

  getRecentWarnings(limit: number = 100): Warning[] {
    const stmt = this.db.prepare(`
      SELECT * FROM warnings
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      eraId: row.era_id,
      sessionId: row.session_id,
      blockNumber: row.block_number,
      type: row.type,
      message: row.message,
      severity: row.severity,
      timestamp: row.timestamp,
    }));
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

    const cutoffEra = latestEra.eraId - this.maxEras;

    const stmt = this.db.prepare('DELETE FROM eras WHERE era_id < ?');
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
    const blocksRCCount = this.db.prepare('SELECT COUNT(*) as count FROM blocks_rc').get() as { count: number };
    const blocksAHCount = this.db.prepare('SELECT COUNT(*) as count FROM blocks_ah').get() as { count: number };
    const eventsRCCount = this.db.prepare('SELECT COUNT(*) as count FROM events_rc').get() as { count: number };
    const eventsAHCount = this.db.prepare('SELECT COUNT(*) as count FROM events_ah').get() as { count: number };
    const eraCount = this.db.prepare('SELECT COUNT(*) as count FROM eras').get() as { count: number };
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const warningCount = this.db.prepare('SELECT COUNT(*) as count FROM warnings').get() as { count: number };

    return {
      blocksRC: blocksRCCount.count,
      blocksAH: blocksAHCount.count,
      eventsRC: eventsRCCount.count,
      eventsAH: eventsAHCount.count,
      eras: eraCount.count,
      sessions: sessionCount.count,
      warnings: warningCount.count,
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
