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
    this.runMigrations();
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
        block_number INTEGER, -- Nullable for future sessions not yet ended
        activation_timestamp INTEGER,
        active_era_id INTEGER,
        planned_era_id INTEGER,
        validator_points_total INTEGER NOT NULL,
        FOREIGN KEY (block_number) REFERENCES blocks_ah(block_number) ON DELETE SET NULL
        -- Note: No FK constraints for active_era_id and planned_era_id as they may reference future eras
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_block ON sessions(block_number);
      CREATE INDEX IF NOT EXISTS idx_sessions_active_era ON sessions(active_era_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_planned_era ON sessions(planned_era_id);

      -- Eras table
      -- Created from stakingRelaychainClient.SessionReportReceived events with activation_timestamp
      CREATE TABLE IF NOT EXISTS eras (
        era_id INTEGER PRIMARY KEY,
        session_start INTEGER NOT NULL,
        session_end INTEGER,
        start_time INTEGER NOT NULL,
        inflation_total TEXT,
        inflation_validators TEXT,
        inflation_treasury TEXT,
        validators_elected INTEGER
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

      -- Election phases table (for tracking multi-block election progress)
      CREATE TABLE IF NOT EXISTS election_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        era_id INTEGER NOT NULL,
        round INTEGER NOT NULL,
        phase TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        validator_candidates INTEGER,
        nominator_candidates INTEGER,
        target_validator_count INTEGER,
        minimum_score TEXT,
        sorted_scores TEXT,
        queued_solution_score TEXT,
        validators_elected INTEGER,
        FOREIGN KEY (era_id) REFERENCES eras(era_id) ON DELETE CASCADE,
        FOREIGN KEY (block_number) REFERENCES blocks_ah(block_number) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_election_phases_era ON election_phases(era_id);
      CREATE INDEX IF NOT EXISTS idx_election_phases_round ON election_phases(round);
      CREATE INDEX IF NOT EXISTS idx_election_phases_phase ON election_phases(phase);
      CREATE INDEX IF NOT EXISTS idx_election_phases_block ON election_phases(block_number);

      -- Indexer state table (for tracking sync progress)
      CREATE TABLE IF NOT EXISTS indexer_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Reimport requests table (for API-triggered reimports)
      CREATE TABLE IF NOT EXISTS reimport_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain TEXT NOT NULL CHECK(chain IN ('relay_chain', 'asset_hub')),
        block_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
        submitted_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_reimport_status ON reimport_requests(status);
      CREATE INDEX IF NOT EXISTS idx_reimport_submitted ON reimport_requests(submitted_at);

      -- Migration tracking table
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    this.logger.info('Database schema initialized');
  }

  /**
   * Run database migrations idempotently
   */
  private runMigrations(): void {
    this.logger.info('Checking for pending migrations');

    // Get applied migrations
    const appliedMigrations = this.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[];

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    // Migration 1: Make sessions.block_number nullable and change ON DELETE CASCADE to SET NULL
    if (!appliedVersions.has(1)) {
      this.logger.info('Applying migration 1: Update sessions table schema');

      try {
        // Check if sessions table exists and has data
        const tableExists = this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
          .get();

        if (tableExists) {
          // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
          this.db.exec(`
            BEGIN TRANSACTION;

            -- Create new sessions table with updated schema
            CREATE TABLE sessions_new (
              session_id INTEGER PRIMARY KEY,
              block_number INTEGER, -- Now nullable for future sessions
              activation_timestamp INTEGER,
              active_era_id INTEGER,
              planned_era_id INTEGER,
              validator_points_total INTEGER NOT NULL,
              FOREIGN KEY (block_number) REFERENCES blocks_ah(block_number) ON DELETE SET NULL
            );

            -- Copy existing data
            INSERT INTO sessions_new
            SELECT session_id, block_number, activation_timestamp, active_era_id, planned_era_id, validator_points_total
            FROM sessions;

            -- Drop old table
            DROP TABLE sessions;

            -- Rename new table
            ALTER TABLE sessions_new RENAME TO sessions;

            -- Recreate indexes
            CREATE INDEX idx_sessions_block ON sessions(block_number);
            CREATE INDEX idx_sessions_active_era ON sessions(active_era_id);
            CREATE INDEX idx_sessions_planned_era ON sessions(planned_era_id);

            COMMIT;
          `);

          this.logger.info('Migration 1: Sessions table schema updated successfully');
        } else {
          this.logger.info('Migration 1: Sessions table does not exist yet, skipping');
        }

        // Record migration
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(1, Date.now());

      } catch (error) {
        this.logger.error({ error }, 'Migration 1 failed');
        throw error;
      }
    }

    this.logger.info({ appliedMigrations: appliedVersions.size + (appliedVersions.has(1) ? 0 : 1) }, 'Migrations complete');
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

  blockExistsRC(blockNumber: number): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM blocks_rc WHERE block_number = ?');
    return stmt.get(blockNumber) !== undefined;
  }

  blockExistsAH(blockNumber: number): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM blocks_ah WHERE block_number = ?');
    return stmt.get(blockNumber) !== undefined;
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

  deleteBlockRC(blockNumber: number): void {
    // Delete events first (cascade should handle this, but being explicit)
    this.db.prepare('DELETE FROM events_rc WHERE block_number = ?').run(blockNumber);
    // Delete block
    this.db.prepare('DELETE FROM blocks_rc WHERE block_number = ?').run(blockNumber);
    this.logger.debug({ blockNumber }, 'Deleted RC block and events');
  }

  deleteBlockAH(blockNumber: number): void {
    // Delete events first (cascade should handle this, but being explicit)
    this.db.prepare('DELETE FROM events_ah WHERE block_number = ?').run(blockNumber);
    // Delete block
    this.db.prepare('DELETE FROM blocks_ah WHERE block_number = ?').run(blockNumber);
    this.logger.debug({ blockNumber }, 'Deleted AH block and events');
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
        session_id, block_number, activation_timestamp, active_era_id, planned_era_id, validator_points_total
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        block_number = COALESCE(excluded.block_number, block_number),
        activation_timestamp = COALESCE(excluded.activation_timestamp, activation_timestamp),
        active_era_id = COALESCE(excluded.active_era_id, active_era_id),
        planned_era_id = COALESCE(excluded.planned_era_id, planned_era_id),
        validator_points_total = CASE WHEN excluded.validator_points_total > 0 THEN excluded.validator_points_total ELSE validator_points_total END
    `);

    stmt.run(
      session.sessionId,
      session.blockNumber,
      session.activationTimestamp,
      session.activeEraId,
      session.plannedEraId,
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
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
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
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
      validatorPointsTotal: row.validator_points_total,
    } : null;
  }

  getSessionsByEra(eraId: number): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE active_era_id = ? ORDER BY session_id');
    const rows = stmt.all(eraId) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
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
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
      validatorPointsTotal: row.validator_points_total,
    }));
  }

  // ===== ERA METHODS =====

  upsertEra(era: Era): void {
    const stmt = this.db.prepare(`
      INSERT INTO eras (era_id, session_start, session_end, start_time, inflation_total, inflation_validators, inflation_treasury, validators_elected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(era_id) DO UPDATE SET
        session_start = excluded.session_start,
        session_end = excluded.session_end,
        start_time = excluded.start_time,
        inflation_total = COALESCE(excluded.inflation_total, inflation_total),
        inflation_validators = COALESCE(excluded.inflation_validators, inflation_validators),
        inflation_treasury = COALESCE(excluded.inflation_treasury, inflation_treasury),
        validators_elected = COALESCE(excluded.validators_elected, validators_elected)
    `);

    stmt.run(
      era.eraId,
      era.sessionStart,
      era.sessionEnd,
      era.startTime,
      (era as any).inflationTotal || null,
      (era as any).inflationValidators || null,
      (era as any).inflationTreasury || null,
      (era as any).validatorsElected || null
    );
  }

  updateEraInflation(eraId: number, inflationTotal: string, inflationValidators: string, inflationTreasury: string): void {
    const stmt = this.db.prepare(`
      UPDATE eras
      SET inflation_total = ?, inflation_validators = ?, inflation_treasury = ?
      WHERE era_id = ?
    `);

    stmt.run(inflationTotal, inflationValidators, inflationTreasury, eraId);
  }

  updateEraValidatorCount(eraId: number, validatorsElected: number): void {
    const stmt = this.db.prepare(`
      UPDATE eras
      SET validators_elected = ?
      WHERE era_id = ?
    `);

    stmt.run(validatorsElected, eraId);
  }

  getEra(eraId: number): Era | null {
    const stmt = this.db.prepare('SELECT * FROM eras WHERE era_id = ?');
    const row = stmt.get(eraId) as any;
    return row ? {
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
      inflationTotal: row.inflation_total,
      inflationValidators: row.inflation_validators,
      inflationTreasury: row.inflation_treasury,
      validatorsElected: row.validators_elected,
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
      inflationTotal: row.inflation_total,
      inflationValidators: row.inflation_validators,
      inflationTreasury: row.inflation_treasury,
      validatorsElected: row.validators_elected,
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
      inflationTotal: row.inflation_total,
      inflationValidators: row.inflation_validators,
      inflationTreasury: row.inflation_treasury,
      validatorsElected: row.validators_elected,
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

  getStateWithTimestamp(key: string): { value: string; updatedAt: number } | null {
    const stmt = this.db.prepare('SELECT value, updated_at FROM indexer_state WHERE key = ?');
    const result = stmt.get(key) as { value: string; updated_at: number } | undefined;
    return result ? { value: result.value, updatedAt: result.updated_at } : null;
  }

  // Set multiple state values in a transaction
  setMultipleStates(states: Record<string, string>): void {
    const stmt = this.db.prepare(`
      INSERT INTO indexer_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction((entries: [string, string][]) => {
      const now = Date.now();
      for (const [key, value] of entries) {
        stmt.run(key, value, now);
      }
    });

    transaction(Object.entries(states));
  }

  // ===== ELECTION PHASE METHODS =====

  insertElectionPhase(phase: {
    eraId: number;
    round: number;
    phase: string;
    blockNumber: number;
    eventId: string;
    timestamp: number;
    validatorCandidates?: number | null;
    nominatorCandidates?: number | null;
    targetValidatorCount?: number | null;
    minimumScore?: string | null;
    sortedScores?: string | null;
    queuedSolutionScore?: string | null;
    validatorsElected?: number | null;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO election_phases (
        era_id, round, phase, block_number, event_id, timestamp,
        validator_candidates, nominator_candidates, target_validator_count,
        minimum_score, sorted_scores, queued_solution_score, validators_elected
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      phase.eraId,
      phase.round,
      phase.phase,
      phase.blockNumber,
      phase.eventId,
      phase.timestamp,
      phase.validatorCandidates || null,
      phase.nominatorCandidates || null,
      phase.targetValidatorCount || null,
      phase.minimumScore || null,
      phase.sortedScores || null,
      phase.queuedSolutionScore || null,
      phase.validatorsElected || null
    );

    return result.lastInsertRowid as number;
  }

  getElectionPhasesByEra(eraId: number): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM election_phases
      WHERE era_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(eraId) as any[];
    return rows.map(row => ({
      id: row.id,
      eraId: row.era_id,
      round: row.round,
      phase: row.phase,
      blockNumber: row.block_number,
      eventId: row.event_id,
      timestamp: row.timestamp,
      validatorCandidates: row.validator_candidates,
      nominatorCandidates: row.nominator_candidates,
      targetValidatorCount: row.target_validator_count,
      minimumScore: row.minimum_score,
      sortedScores: row.sorted_scores,
      queuedSolutionScore: row.queued_solution_score,
      validatorsElected: row.validators_elected,
    }));
  }

  getLatestElectionPhaseByRound(round: number): any | null {
    const stmt = this.db.prepare(`
      SELECT * FROM election_phases
      WHERE round = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const row = stmt.get(round) as any;
    if (!row) return null;

    return {
      id: row.id,
      eraId: row.era_id,
      round: row.round,
      phase: row.phase,
      blockNumber: row.block_number,
      eventId: row.event_id,
      timestamp: row.timestamp,
      validatorCandidates: row.validator_candidates,
      nominatorCandidates: row.nominator_candidates,
      targetValidatorCount: row.target_validator_count,
      minimumScore: row.minimum_score,
      sortedScores: row.sorted_scores,
      queuedSolutionScore: row.queued_solution_score,
      validatorsElected: row.validators_elected,
    };
  }

  getAllElectionPhases(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM election_phases
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      eraId: row.era_id,
      round: row.round,
      phase: row.phase,
      blockNumber: row.block_number,
      eventId: row.event_id,
      timestamp: row.timestamp,
      validatorCandidates: row.validator_candidates,
      nominatorCandidates: row.nominator_candidates,
      targetValidatorCount: row.target_validator_count,
      minimumScore: row.minimum_score,
      sortedScores: row.sorted_scores,
      queuedSolutionScore: row.queued_solution_score,
      validatorsElected: row.validators_elected,
    }));
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
    const electionPhasesCount = this.db.prepare('SELECT COUNT(*) as count FROM election_phases').get() as { count: number };

    return {
      blocksRC: blocksRCCount.count,
      blocksAH: blocksAHCount.count,
      eventsRC: eventsRCCount.count,
      eventsAH: eventsAHCount.count,
      eras: eraCount.count,
      sessions: sessionCount.count,
      warnings: warningCount.count,
      electionPhases: electionPhasesCount.count,
    };
  }

  // ===== REIMPORT REQUEST METHODS =====

  submitReimportRequest(chain: string, blockNumber: number): number {
    const stmt = this.db.prepare(`
      INSERT INTO reimport_requests (chain, block_number, status, submitted_at)
      VALUES (?, ?, 'pending', ?)
    `);
    const result = stmt.run(chain, blockNumber, Date.now());
    return result.lastInsertRowid as number;
  }

  getPendingReimportRequests(limit: number = 5): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reimport_requests
      WHERE status = 'pending'
      ORDER BY submitted_at ASC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  getAllReimportRequests(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reimport_requests
      ORDER BY submitted_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  updateReimportRequestStatus(id: number, status: string, error?: string): void {
    const stmt = this.db.prepare(`
      UPDATE reimport_requests
      SET status = ?, completed_at = ?, error = ?
      WHERE id = ?
    `);
    stmt.run(status, Date.now(), error || null, id);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('Database closed');
  }
}
