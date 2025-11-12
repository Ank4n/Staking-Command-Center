import Database from 'better-sqlite3';
import type {
  Era,
  Session,
  Block,
  Warning,
  BlockchainEvent,
  ApiStatus,
  EraDetails,
  ChainSyncInfo,
  SyncStatus,
} from '@staking-cc/shared';

export class DatabaseClient {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Open in read-write mode to properly read from WAL
    // We never write anyway, but this allows us to see latest data
    this.db = new Database(dbPath, { fileMustExist: true });

    // Ensure WAL mode is enabled (should already be set by indexer)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  /**
   * Refresh connection to see latest WAL data
   * SQLite connections in WAL mode see a snapshot from when they were opened
   */
  private refreshConnection(): void {
    // Close existing connection
    this.db.close();

    // Reopen to see latest data
    this.db = new Database(this.dbPath, { fileMustExist: true });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  // ===== STATUS =====

  getStatus(): ApiStatus {
    // Refresh connection to see latest WAL data
    this.refreshConnection();

    const latestEra = this.db.prepare('SELECT * FROM eras ORDER BY era_id DESC LIMIT 1').get() as any | undefined;
    const latestSession = this.db.prepare('SELECT * FROM sessions ORDER BY session_id DESC LIMIT 1').get() as any | undefined;

    // Get sync info for Relay Chain
    const relayChain = this.getChainSyncInfo('RC');

    // Get sync info for Asset Hub
    const assetHub = this.getChainSyncInfo('AH');

    return {
      chain: process.env.CHAIN as any,
      currentEra: latestEra?.era_id || null,
      currentSession: latestSession?.session_id || null,
      lastUpdateTime: Date.now(),
      rpcEndpointRC: 'N/A',
      rpcEndpointAH: 'N/A',
      relayChain,
      assetHub,
    };
  }

  private getChainSyncInfo(chain: 'RC' | 'AH'): ChainSyncInfo {
    const suffix = chain;

    // Get state values
    const isSyncing = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?')
      .get(`isSyncing${suffix}`) as { value: string } | undefined;
    const currentHeight = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?')
      .get(`currentHeight${suffix}`) as { value: string } | undefined;
    const totalMissingBlocks = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?')
      .get(`totalMissingBlocks${suffix}`) as { value: string } | undefined;
    const syncedBlocks = this.db.prepare('SELECT value FROM indexer_state WHERE key = ?')
      .get(`syncedBlocks${suffix}`) as { value: string } | undefined;

    // Get latest synced block
    const latestBlock = this.db.prepare(`SELECT * FROM blocks_${chain.toLowerCase()} ORDER BY block_number DESC LIMIT 1`)
      .get() as any | undefined;

    const lastBlockNumber = latestBlock?.block_number || 0;
    const lastBlockTime = latestBlock?.timestamp || 0;
    const heightValue = currentHeight ? parseInt(currentHeight.value, 10) : lastBlockNumber;
    const isSyncingValue = isSyncing?.value === 'true';

    // Determine sync status
    let status: SyncStatus;
    if (isSyncingValue) {
      status = 'syncing';
    } else if (lastBlockTime > 0) {
      const timeSinceLastBlock = Date.now() - lastBlockTime;
      // If last block was less than 1 minute ago, consider in-sync
      status = timeSinceLastBlock < 60000 ? 'in-sync' : 'out-of-sync';
    } else {
      status = 'out-of-sync';
    }

    // Calculate sync progress if syncing
    let syncProgress = undefined;
    if (isSyncingValue && totalMissingBlocks && syncedBlocks) {
      const total = parseInt(totalMissingBlocks.value, 10);
      const synced = parseInt(syncedBlocks.value, 10);

      if (total > 0) {
        const percentage = Math.min(100, Math.max(0, (synced / total) * 100));
        const blocksRemaining = Math.max(0, total - synced);

        syncProgress = {
          target: heightValue - total,
          current: heightValue,
          percentage,
          blocksRemaining,
        };
      }
    }

    return {
      status,
      lastBlockNumber,
      lastBlockTime,
      currentHeight: heightValue,
      syncProgress,
    };
  }

  // ===== BLOCKS =====

  getBlocksRC(limit: number = 100): Block[] {
    const rows = this.db
      .prepare('SELECT * FROM blocks_rc ORDER BY block_number DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({ blockNumber: row.block_number, timestamp: row.timestamp }));
  }

  getBlocksAH(limit: number = 100): Block[] {
    const rows = this.db
      .prepare('SELECT * FROM blocks_ah ORDER BY block_number DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({ blockNumber: row.block_number, timestamp: row.timestamp }));
  }

  getBlockRC(blockNumber: number): Block | null {
    const row = this.db
      .prepare('SELECT * FROM blocks_rc WHERE block_number = ?')
      .get(blockNumber) as any | undefined;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  getBlockAH(blockNumber: number): Block | null {
    const row = this.db
      .prepare('SELECT * FROM blocks_ah WHERE block_number = ?')
      .get(blockNumber) as any | undefined;
    return row ? { blockNumber: row.block_number, timestamp: row.timestamp } : null;
  }

  // ===== ERAS =====

  private getEraEndTime(sessionEnd: number | null): number | null {
    if (sessionEnd === null) return null;

    // Get the activation timestamp of the session at sessionEnd
    const session = this.db
      .prepare('SELECT activation_timestamp FROM sessions WHERE session_id = ?')
      .get(sessionEnd) as { activation_timestamp: number | null } | undefined;

    return session?.activation_timestamp || null;
  }

  getEras(limit: number = 100): Era[] {
    const rows = this.db
      .prepare('SELECT * FROM eras ORDER BY era_id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
      endTime: this.getEraEndTime(row.session_end),
      inflationTotal: row.inflation_total,
      inflationValidators: row.inflation_validators,
      inflationTreasury: row.inflation_treasury,
      validatorsElected: row.validators_elected,
    }));
  }

  getEra(eraId: number): EraDetails | null {
    const row = this.db.prepare('SELECT * FROM eras WHERE era_id = ?').get(eraId) as any | undefined;

    if (!row) {
      return null;
    }

    const era: Era = {
      eraId: row.era_id,
      sessionStart: row.session_start,
      sessionEnd: row.session_end,
      startTime: row.start_time,
      endTime: this.getEraEndTime(row.session_end),
      inflationTotal: row.inflation_total,
      inflationValidators: row.inflation_validators,
      inflationTreasury: row.inflation_treasury,
      validatorsElected: row.validators_elected,
    };

    const sessionRows = this.db
      .prepare('SELECT * FROM sessions WHERE active_era_id = ? ORDER BY session_id')
      .all(eraId) as any[];

    const sessions: Session[] = sessionRows.map(s => ({
      sessionId: s.session_id,
      blockNumber: s.block_number,
      activationTimestamp: s.activation_timestamp,
      activeEraId: s.active_era_id,
      plannedEraId: s.planned_era_id,
      validatorPointsTotal: s.validator_points_total,
    }));

    const warningRows = this.db
      .prepare('SELECT * FROM warnings WHERE era_id = ? ORDER BY timestamp DESC')
      .all(eraId) as any[];

    const warnings: Warning[] = warningRows.map(w => ({
      id: w.id,
      eraId: w.era_id,
      sessionId: w.session_id,
      blockNumber: w.block_number,
      type: w.type,
      message: w.message,
      severity: w.severity,
      timestamp: w.timestamp,
    }));

    return {
      ...era,
      sessions,
      warnings,
    };
  }

  // ===== SESSIONS =====

  getSessions(limit: number = 100): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY session_id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
      validatorPointsTotal: row.validator_points_total,
    }));
  }

  getSession(sessionId: number): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as any | undefined;

    if (!row) return null;

    return {
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
      validatorPointsTotal: row.validator_points_total,
    };
  }

  getSessionsByEra(eraId: number): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE active_era_id = ? ORDER BY session_id')
      .all(eraId) as any[];
    return rows.map(row => ({
      sessionId: row.session_id,
      blockNumber: row.block_number,
      activationTimestamp: row.activation_timestamp,
      activeEraId: row.active_era_id,
      plannedEraId: row.planned_era_id,
      validatorPointsTotal: row.validator_points_total,
    }));
  }

  // ===== WARNINGS =====

  getWarnings(limit: number = 100): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];
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

  getWarningsByEra(eraId: number): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings WHERE era_id = ? ORDER BY timestamp DESC')
      .all(eraId) as any[];
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

  getWarningsBySeverity(severity: string, limit: number = 100): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings WHERE severity = ? ORDER BY timestamp DESC LIMIT ?')
      .all(severity, limit) as any[];
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

  // ===== EVENTS =====

  getEventsRC(limit: number = 1000): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_rc ORDER BY block_number DESC, id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsAH(limit: number = 1000): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_ah ORDER BY block_number DESC, id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByTypeRC(eventType: string, limit: number = 1000): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_rc WHERE event_type = ? ORDER BY block_number DESC LIMIT ?')
      .all(eventType, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByTypeAH(eventType: string, limit: number = 1000): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_ah WHERE event_type = ? ORDER BY block_number DESC LIMIT ?')
      .all(eventType, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByBlockRC(blockNumber: number): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_rc WHERE block_number = ? ORDER BY id')
      .all(blockNumber) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByBlockAH(blockNumber: number): BlockchainEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events_ah WHERE block_number = ? ORDER BY id')
      .all(blockNumber) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  getEventsByEraAH(eraId: number): BlockchainEvent[] {
    // Get era to determine session range
    const era = this.db.prepare('SELECT session_start, session_end FROM eras WHERE era_id = ?').get(eraId) as
      { session_start: number; session_end: number | null } | undefined;

    if (!era) {
      return [];
    }

    // Calculate block range for the era's active lifetime:
    // - Start: when previous session ended (when this era's first session started)
    // - End: when era's last session ended (or use first session if era still active)

    const prevSession = this.db
      .prepare('SELECT block_number FROM sessions WHERE session_id = ?')
      .get(era.session_start - 1) as { block_number: number } | undefined;

    const firstSession = this.db
      .prepare('SELECT block_number FROM sessions WHERE session_id = ?')
      .get(era.session_start) as { block_number: number } | undefined;

    // Start from previous session's end block + 1 (exclude the block where previous era ended)
    // If no previous session, start from first session's block
    let startBlock: number;
    if (prevSession?.block_number) {
      startBlock = prevSession.block_number + 1;
    } else if (firstSession?.block_number) {
      startBlock = firstSession.block_number;
    } else {
      return [];
    }

    // If era has ended, use session_end's block. If still active, use current block (query all from start onwards)
    let endBlock: number;
    if (era.session_end !== null) {
      const lastSession = this.db
        .prepare('SELECT block_number FROM sessions WHERE session_id = ?')
        .get(era.session_end) as { block_number: number } | undefined;
      endBlock = lastSession?.block_number || Number.MAX_SAFE_INTEGER;
    } else {
      // Era still active, get all events from startBlock onwards
      endBlock = Number.MAX_SAFE_INTEGER;
    }

    // Also include blocks where election phases for this era occurred
    // (Election phases happen BEFORE the era starts, during the previous era)
    const electionPhases = this.db
      .prepare('SELECT MIN(block_number) as min_block, MAX(block_number) as max_block FROM election_phases WHERE era_id = ?')
      .get(eraId) as { min_block: number | null; max_block: number | null } | undefined;

    if (electionPhases?.min_block) {
      // Expand the range to include election phase blocks (which happened before the era started)
      startBlock = Math.min(startBlock, electionPhases.min_block);
    }

    if (electionPhases?.max_block) {
      // Also extend end block if needed (though election blocks should be before era start)
      endBlock = Math.max(endBlock, electionPhases.max_block);
    }

    const rows = this.db
      .prepare('SELECT * FROM events_ah WHERE block_number >= ? AND block_number <= ? ORDER BY block_number DESC, id DESC')
      .all(startBlock, endBlock) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      eventId: row.event_id,
      eventType: row.event_type,
      data: row.data,
    }));
  }

  // ===== ELECTION PHASES =====

  getElectionPhasesByEra(eraId: number): any[] {
    const rows = this.db
      .prepare('SELECT * FROM election_phases WHERE era_id = ? ORDER BY timestamp ASC')
      .all(eraId) as any[];
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
      expectedDurationBlocks: row.expected_duration_blocks,
      status: row.status,
    }));
  }

  getAllElectionPhases(limit: number = 100): any[] {
    const rows = this.db
      .prepare('SELECT * FROM election_phases ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];
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
      expectedDurationBlocks: row.expected_duration_blocks,
      status: row.status,
    }));
  }

  // ===== ELECTION SCORES =====

  getAllElectionWinners(limit: number = 50): any[] {
    const rows = this.db
      .prepare('SELECT * FROM election_scores WHERE status = ? ORDER BY round DESC LIMIT ?')
      .all('rewarded', limit) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      round: row.round,
      submitter: row.submitter,
      minimalStake: row.minimal_stake,
      sumStake: row.sum_stake,
      sumStakeSquared: row.sum_stake_squared,
      status: row.status,
      eraId: row.era_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getElectionWinnersByEra(eraId: number): any[] {
    const rows = this.db
      .prepare('SELECT * FROM election_scores WHERE era_id = ? AND status = ? ORDER BY round DESC')
      .all(eraId, 'rewarded') as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      round: row.round,
      submitter: row.submitter,
      minimalStake: row.minimal_stake,
      sumStake: row.sum_stake,
      sumStakeSquared: row.sum_stake_squared,
      status: row.status,
      eraId: row.era_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getElectionWinnerByRound(round: number): any | null {
    const row = this.db
      .prepare('SELECT * FROM election_scores WHERE round = ? AND status = ? LIMIT 1')
      .get(round, 'rewarded') as any;

    if (!row) return null;

    return {
      id: row.id,
      blockNumber: row.block_number,
      round: row.round,
      submitter: row.submitter,
      minimalStake: row.minimal_stake,
      sumStake: row.sum_stake,
      sumStakeSquared: row.sum_stake_squared,
      status: row.status,
      eraId: row.era_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getElectionSubmissionCount(round: number): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM election_scores WHERE round = ?')
      .get(round) as { count: number };
    return result.count;
  }

  getElectionScoresByRound(round: number): any[] {
    const rows = this.db
      .prepare('SELECT * FROM election_scores WHERE round = ? ORDER BY created_at ASC')
      .all(round) as any[];
    return rows.map(row => ({
      id: row.id,
      blockNumber: row.block_number,
      round: row.round,
      submitter: row.submitter,
      minimalStake: row.minimal_stake,
      sumStake: row.sum_stake,
      sumStakeSquared: row.sum_stake_squared,
      status: row.status,
      eraId: row.era_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ===== STATS =====

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

  // ===== DATABASE TABLE VIEWER =====

  // Get all table names
  getTables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    return rows.map(r => r.name);
  }

  // Get table schema
  getTableSchema(tableName: string): any[] {
    return this.db.prepare(`PRAGMA table_info(${tableName})`).all();
  }

  // Get table data (with limit)
  getTableData(tableName: string, limit: number = 100): any[] {
    return this.db.prepare(`SELECT * FROM ${tableName} LIMIT ?`).all(limit);
  }

  // ===== REIMPORT REQUESTS =====

  submitReimportRequest(chain: string, blockNumber: number): number {
    const stmt = this.db.prepare(`
      INSERT INTO reimport_requests (chain, block_number, status, submitted_at)
      VALUES (?, ?, 'pending', ?)
    `);
    const result = stmt.run(chain, blockNumber, Date.now());
    return result.lastInsertRowid as number;
  }

  getReimportRequests(limit: number = 100): any[] {
    const rows = this.db
      .prepare('SELECT * FROM reimport_requests ORDER BY submitted_at DESC LIMIT ?')
      .all(limit) as any[];
    return rows;
  }

  close(): void {
    this.db.close();
  }
}
