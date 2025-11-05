import type { ApiPromise } from '@polkadot/api';
import type { Header, EventRecord } from '@polkadot/types/interfaces';
import type { Logger } from 'pino';
import type { StakingDatabase } from '../database';
import { shouldTrackEventRC, shouldTrackEventAH } from '../utils/eventFilters';

export class Indexer {
  private apiRC: ApiPromise;
  private apiAH: ApiPromise;
  private db: StakingDatabase;
  private logger: Logger;
  private backfillBlocks: number;
  private isRunning: boolean = false;
  private unsubscribeRC: (() => void) | null = null;
  private unsubscribeAH: (() => void) | null = null;
  private gapFillerInterval: NodeJS.Timeout | null = null;
  private reimportCheckerInterval: NodeJS.Timeout | null = null;

  constructor(apiRC: ApiPromise, apiAH: ApiPromise, db: StakingDatabase, logger: Logger, syncBlocks: number) {
    this.apiRC = apiRC;
    this.apiAH = apiAH;
    this.db = db;
    this.logger = logger.child({ component: 'Indexer' });
    this.backfillBlocks = syncBlocks;
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

      // Calculate target blocks: current height - syncBlocks (but not less than 1)
      const targetBlockRC = Math.max(1, currentBlockRC - this.backfillBlocks);
      const targetBlockAH = Math.max(1, currentBlockAH - this.backfillBlocks);

      this.logger.info({
        targetBlockRC,
        targetBlockAH,
        syncBlocks: this.backfillBlocks
      }, 'Target sync range calculated');

      // Count missing blocks before syncing
      let missingBlocksCountRC = 0;
      for (let i = targetBlockRC; i <= currentBlockRC; i++) {
        if (!this.db.blockExistsRC(i)) missingBlocksCountRC++;
      }

      let missingBlocksCountAH = 0;
      for (let i = targetBlockAH; i <= currentBlockAH; i++) {
        if (!this.db.blockExistsAH(i)) missingBlocksCountAH++;
      }

      // Store current heights, targets, and total missing blocks in state
      this.db.setMultipleStates({
        'currentHeightRC': currentBlockRC.toString(),
        'currentHeightAH': currentBlockAH.toString(),
        'targetBlockRC': targetBlockRC.toString(),
        'targetBlockAH': targetBlockAH.toString(),
        'totalMissingBlocksRC': missingBlocksCountRC.toString(),
        'totalMissingBlocksAH': missingBlocksCountAH.toString(),
        'syncedBlocksRC': '0',
        'syncedBlocksAH': '0',
        'isSyncingRC': 'true',
        'isSyncingAH': 'true',
      });

      // Sync missing blocks in range for both chains in parallel
      await Promise.all([
        this.syncMissingBlocksRC(targetBlockRC, currentBlockRC),
        this.syncMissingBlocksAH(targetBlockAH, currentBlockAH),
      ]);

      // Mark syncing as complete
      this.db.setMultipleStates({
        'isSyncingRC': 'false',
        'isSyncingAH': 'false',
      });

      // Subscribe to new finalized blocks for both chains
      this.isRunning = true;
      this.subscribeToNewBlocksRC();
      this.subscribeToNewBlocksAH();

      // Start periodic gap filler (every 30 seconds)
      this.startGapFiller();

      // Start periodic reimport checker (every 10 seconds)
      this.startReimportChecker();

      this.logger.info('Indexer started successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start indexer');
      throw error;
    }
  }

  /**
   * Start periodic gap detection and filling
   */
  private startGapFiller(): void {
    this.logger.info('Starting periodic gap filler (every 30 seconds)');

    this.gapFillerInterval = setInterval(async () => {
      try {
        await this.fillGaps();
      } catch (error) {
        this.logger.error({ error }, 'Error in gap filler');
      }
    }, 30000); // Run every 30 seconds
  }

  /**
   * Start periodic reimport request checker
   */
  private startReimportChecker(): void {
    this.logger.info('Starting periodic reimport checker (every 10 seconds)');

    this.reimportCheckerInterval = setInterval(async () => {
      try {
        await this.processReimportRequests();
      } catch (error) {
        this.logger.error({ error }, 'Error in reimport checker');
      }
    }, 10000); // Run every 10 seconds
  }

  /**
   * Process pending reimport requests
   */
  private async processReimportRequests(): Promise<void> {
    // Get pending reimport requests (up to 5 at a time)
    const pendingRequests = this.db.getPendingReimportRequests(5);

    if (pendingRequests.length === 0) {
      return;
    }

    this.logger.info({ count: pendingRequests.length }, 'Processing reimport requests');

    for (const request of pendingRequests) {
      try {
        this.logger.info({ id: request.id, chain: request.chain, blockNumber: request.block_number }, 'Reimporting block');

        // Mark as processing
        this.db.updateReimportRequestStatus(request.id, 'processing');

        // Delete old block data atomically
        // Events will be cascade deleted, but sessions will keep their data (block_number will be SET NULL with new schema)
        // Block and events will be recreated, sessions will be upserted (preserving existing data)
        if (request.chain === 'relay_chain') {
          this.db.deleteBlockRC(request.block_number);
        } else if (request.chain === 'asset_hub') {
          this.db.deleteBlockAH(request.block_number);
        }

        // Re-fetch and process the block
        if (request.chain === 'relay_chain') {
          await this.processBlockByNumberRC(request.block_number);
        } else if (request.chain === 'asset_hub') {
          await this.processBlockByNumberAH(request.block_number);
        }

        // Mark as completed
        this.db.updateReimportRequestStatus(request.id, 'completed');

        this.logger.info({ id: request.id, chain: request.chain, blockNumber: request.block_number }, 'Block reimported successfully');
      } catch (error) {
        this.logger.error({ error, id: request.id, chain: request.chain, blockNumber: request.block_number }, 'Failed to reimport block');

        // Mark as failed (block data was deleted, but this is expected for reimport)
        this.db.updateReimportRequestStatus(request.id, 'failed', String(error));
      }
    }
  }

  /**
   * Detect and fill gaps in recent blocks
   */
  private async fillGaps(): Promise<void> {
    // Get current heights
    const currentHeightRC = this.db.getState('currentHeightRC');
    const currentHeightAH = this.db.getState('currentHeightAH');

    if (!currentHeightRC || !currentHeightAH) {
      return;
    }

    const heightRC = parseInt(currentHeightRC, 10);
    const heightAH = parseInt(currentHeightAH, 10);

    // Check last 50 blocks for gaps
    const checkRangeRC = 50;
    const checkRangeAH = 50;

    const startRC = Math.max(1, heightRC - checkRangeRC);
    const startAH = Math.max(1, heightAH - checkRangeAH);

    // Find gaps in RC
    const gapsRC: number[] = [];
    for (let i = startRC; i <= heightRC; i++) {
      if (!this.db.blockExistsRC(i)) {
        gapsRC.push(i);
      }
    }

    // Find gaps in AH
    const gapsAH: number[] = [];
    for (let i = startAH; i <= heightAH; i++) {
      if (!this.db.blockExistsAH(i)) {
        gapsAH.push(i);
      }
    }

    if (gapsRC.length === 0 && gapsAH.length === 0) {
      this.logger.debug('Gap filler: No gaps found in recent blocks');
      return;
    }

    this.logger.warn({
      gapsRC: gapsRC.length,
      gapsAH: gapsAH.length,
      rcBlocks: gapsRC.slice(0, 10),
      ahBlocks: gapsAH.slice(0, 10)
    }, 'Gap filler: Found missing blocks, filling now...');

    // Fill RC gaps
    for (const blockNumber of gapsRC) {
      try {
        await this.processBlockByNumberRC(blockNumber);
        this.logger.info({ blockNumber, chain: 'RC' }, 'Gap filled');
      } catch (error) {
        this.logger.error({ error, blockNumber, chain: 'RC' }, 'Failed to fill gap');
      }
    }

    // Fill AH gaps
    for (const blockNumber of gapsAH) {
      try {
        await this.processBlockByNumberAH(blockNumber);
        this.logger.info({ blockNumber, chain: 'AH' }, 'Gap filled');
      } catch (error) {
        this.logger.error({ error, blockNumber, chain: 'AH' }, 'Failed to fill gap');
      }
    }

    if (gapsRC.length > 0 || gapsAH.length > 0) {
      this.logger.info({
        filledRC: gapsRC.length,
        filledAH: gapsAH.length
      }, 'Gap filling completed');
    }
  }

  /**
   * Sync missing blocks on Relay Chain within the target range
   */
  private async syncMissingBlocksRC(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) {
      this.logger.info('Relay Chain already synced');
      return;
    }

    // Find missing blocks in range
    const missingBlocks: number[] = [];
    for (let i = fromBlock; i <= toBlock; i++) {
      if (!this.db.blockExistsRC(i)) {
        missingBlocks.push(i);
      }
    }

    if (missingBlocks.length === 0) {
      this.logger.info({ fromBlock, toBlock }, 'Relay Chain: all blocks already synced');
      return;
    }

    const totalBlocks = missingBlocks.length;
    this.logger.info({ fromBlock, toBlock, missingBlocks: totalBlocks, totalRange: toBlock - fromBlock + 1 }, 'Syncing missing blocks on Relay Chain');

    let processedCount = 0;
    const failedBlocks: { blockNumber: number; error: string }[] = [];

    for (const blockNumber of missingBlocks) {
      let success = false;
      let lastError: any = null;

      // Retry up to 3 times
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.processBlockByNumberRC(blockNumber);
          success = true;
          break;
        } catch (error) {
          lastError = error;
          this.logger.warn({ error, blockNumber, attempt }, `Error processing RC block (attempt ${attempt}/3)`);

          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      if (success) {
        processedCount++;

        // Update sync progress in state after each block
        this.db.setMultipleStates({
          'syncedBlocksRC': processedCount.toString(),
          'lastProcessedBlockRC': blockNumber.toString(),
        });

        if (processedCount % 10 === 0 || processedCount === totalBlocks) {
          const progress = ((processedCount / totalBlocks) * 100).toFixed(1);
          this.logger.info({
            processed: processedCount,
            total: totalBlocks,
            progress: `${progress}%`,
            chain: 'RC'
          }, 'Relay Chain sync progress');
        }
      } else {
        failedBlocks.push({
          blockNumber,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        this.logger.error({ blockNumber, error: lastError }, 'Failed to process RC block after 3 attempts');
      }
    }

    if (failedBlocks.length > 0) {
      this.logger.error({
        totalBlocks,
        processedCount,
        failedCount: failedBlocks.length,
        failedBlocks: failedBlocks.slice(0, 10), // Show first 10
      }, 'Relay Chain sync completed with errors');
    } else {
      this.logger.info({ totalBlocks, processedCount }, 'Relay Chain sync completed successfully');
    }
  }

  /**
   * Sync missing blocks on Asset Hub within the target range
   */
  private async syncMissingBlocksAH(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) {
      this.logger.info('Asset Hub already synced');
      return;
    }

    // Find missing blocks in range
    const missingBlocks: number[] = [];
    for (let i = fromBlock; i <= toBlock; i++) {
      if (!this.db.blockExistsAH(i)) {
        missingBlocks.push(i);
      }
    }

    if (missingBlocks.length === 0) {
      this.logger.info({ fromBlock, toBlock }, 'Asset Hub: all blocks already synced');
      return;
    }

    const totalBlocks = missingBlocks.length;
    this.logger.info({ fromBlock, toBlock, missingBlocks: totalBlocks, totalRange: toBlock - fromBlock + 1 }, 'Syncing missing blocks on Asset Hub');

    let processedCount = 0;
    const failedBlocks: { blockNumber: number; error: string }[] = [];

    for (const blockNumber of missingBlocks) {
      let success = false;
      let lastError: any = null;

      // Retry up to 3 times
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.processBlockByNumberAH(blockNumber);
          success = true;
          break;
        } catch (error) {
          lastError = error;
          this.logger.warn({ error, blockNumber, attempt }, `Error processing AH block (attempt ${attempt}/3)`);

          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      if (success) {
        processedCount++;

        // Update sync progress in state after each block
        this.db.setMultipleStates({
          'syncedBlocksAH': processedCount.toString(),
          'lastProcessedBlockAH': blockNumber.toString(),
        });

        if (processedCount % 10 === 0 || processedCount === totalBlocks) {
          const progress = ((processedCount / totalBlocks) * 100).toFixed(1);
          this.logger.info({
            processed: processedCount,
            total: totalBlocks,
            progress: `${progress}%`,
            chain: 'AH'
          }, 'Asset Hub sync progress');
        }
      } else {
        failedBlocks.push({
          blockNumber,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        this.logger.error({ blockNumber, error: lastError }, 'Failed to process AH block after 3 attempts');
      }
    }

    if (failedBlocks.length > 0) {
      this.logger.error({
        totalBlocks,
        processedCount,
        failedCount: failedBlocks.length,
        failedBlocks: failedBlocks.slice(0, 10), // Show first 10
      }, 'Asset Hub sync completed with errors');
    } else {
      this.logger.info({ totalBlocks, processedCount }, 'Asset Hub sync completed successfully');
    }
  }

  /**
   * Subscribe to new finalized blocks on Relay Chain
   */
  private subscribeToNewBlocksRC(): void {
    this.logger.info('Subscribing to Relay Chain new finalized blocks');

    this.unsubscribeRC = this.apiRC.rpc.chain.subscribeFinalizedHeads(async (header: Header) => {
      const blockNumber = header.number.toNumber();

      // Skip if already exists
      if (this.db.blockExistsRC(blockNumber)) {
        this.logger.debug({ blockNumber, chain: 'RC' }, 'Block already exists, skipping');
        this.db.setState('currentHeightRC', blockNumber.toString());
        return;
      }

      let success = false;
      let lastError: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.processBlockByNumberRC(blockNumber);
          success = true;

          // Update current height when new blocks arrive
          this.db.setState('currentHeightRC', blockNumber.toString());

          this.logger.info({ blockNumber, chain: 'RC' }, 'New RC block processed');
          break;
        } catch (error) {
          lastError = error;
          this.logger.warn({
            error: error instanceof Error ? error.message : String(error),
            blockNumber,
            attempt,
            chain: 'RC'
          }, `Error processing new RC block (attempt ${attempt}/3)`);

          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!success) {
        const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
        this.logger.error({
          blockNumber,
          chain: 'RC',
          error: errorMsg,
          stack: lastError instanceof Error ? lastError.stack : undefined
        }, '❌ CRITICAL: Failed to process new RC block after 3 attempts - BLOCK WILL BE MISSING');
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

      // Skip if already exists
      if (this.db.blockExistsAH(blockNumber)) {
        this.logger.debug({ blockNumber, chain: 'AH' }, 'Block already exists, skipping');
        this.db.setState('currentHeightAH', blockNumber.toString());
        return;
      }

      let success = false;
      let lastError: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.processBlockByNumberAH(blockNumber);
          success = true;

          // Update current height when new blocks arrive
          this.db.setState('currentHeightAH', blockNumber.toString());

          this.logger.info({ blockNumber, chain: 'AH' }, 'New AH block processed');
          break;
        } catch (error) {
          lastError = error;
          this.logger.warn({
            error: error instanceof Error ? error.message : String(error),
            blockNumber,
            attempt,
            chain: 'AH'
          }, `Error processing new AH block (attempt ${attempt}/3)`);

          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!success) {
        const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
        this.logger.error({
          blockNumber,
          chain: 'AH',
          error: errorMsg,
          stack: lastError instanceof Error ? lastError.stack : undefined
        }, '❌ CRITICAL: Failed to process new AH block after 3 attempts - BLOCK WILL BE MISSING');
      }
    }) as unknown as () => void;
  }

  /**
   * Process a Relay Chain block by its number
   */
  private async processBlockByNumberRC(blockNumber: number): Promise<void> {
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

      const eventType = `${event.section}.${event.method}`;

      // Only track events specified in CLAUDE.md Events Tracking section
      if (!shouldTrackEventRC(eventType)) {
        continue; // Skip this event
      }

      // Create event_id in format: blockNumber-eventIndex (for Subscan linking)
      const eventId = `${blockNumber}-${eventIndex}`;

      this.db.insertEventRC({
        blockNumber,
        eventId,
        eventType,
        data: JSON.stringify(event.toHuman()),
      });
    }

    this.logger.debug({ blockNumber, events: events.length }, 'Processed RC block');
  }

  /**
   * Process an Asset Hub block by its number
   */
  private async processBlockByNumberAH(blockNumber: number): Promise<void> {
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

      const eventType = `${event.section}.${event.method}`;

      // Only track events specified in CLAUDE.md Events Tracking section
      if (!shouldTrackEventAH(eventType)) {
        continue; // Skip this event
      }

      // Create event_id in format: blockNumber-eventIndex (for Subscan linking)
      const eventId = `${blockNumber}-${eventIndex}`;

      this.db.insertEventAH({
        blockNumber,
        eventId,
        eventType,
        data: JSON.stringify(event.toHuman()),
      });

      // Process special events
      await this.processSpecialEvent(event, eventType, blockNumber, blockTimestamp);
    }

    this.logger.debug({ blockNumber, events: events.length }, 'Processed AH block');
  }

  /**
   * Process special events that create sessions and eras
   */
  private async processSpecialEvent(event: any, eventType: string, blockNumber: number, blockTimestamp: number): Promise<void> {
    // Look for stakingRcClient.SessionReportReceived event
    if (eventType.toLowerCase() === 'stakingrcclient.sessionreportreceived') {
      await this.handleSessionReportReceived(event, blockNumber, blockTimestamp);
    }

    // Look for multiBlockElection.PhaseTransitioned event
    if (eventType.toLowerCase() === 'multiblockelection.phasetransitioned') {
      await this.handlePhaseTransitioned(event, blockNumber, blockTimestamp);
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
      // Event structure: { endIndex, activationTimestamp, validatorPointsCounts, leftover }
      const endIndex = event.data.endIndex ? event.data.endIndex.toNumber() : null;
      const totalPoints = event.data.validatorPointsCounts ? event.data.validatorPointsCounts.toNumber() : 0;

      if (endIndex === null) {
        this.logger.warn({ blockNumber, eventData }, 'SessionReportReceived missing endIndex');
        return;
      }

      const sessionId = endIndex;

      // Check if event has activation_timestamp (marks new era)
      // If activation_timestamp is present, this is an era boundary
      // activationTimestamp is Option<(Moment, EraIndex)> - a tuple with timestamp and era_id
      let activationTimestamp: number | null = null;
      let eraIdFromTimestamp: number | null = null;
      let isEraStart = false;

      // Try to extract activation_timestamp from event data
      try {
        const tsField = event.data.activationTimestamp;
        if (tsField) {
          // Check if it's an Option type
          if (typeof tsField.isSome !== 'undefined' && !tsField.isSome) {
            // None
            activationTimestamp = null;
          } else if (typeof tsField.isEmpty !== 'undefined' && tsField.isEmpty) {
            // Empty
            activationTimestamp = null;
          } else if (typeof tsField.unwrap === 'function') {
            // It's an Option with Some value - unwrap it
            const unwrapped = tsField.unwrap();
            // unwrapped should be a tuple (Moment, EraIndex)
            if (unwrapped && unwrapped.length >= 2) {
              const timestamp = unwrapped[0];
              const eraIdx = unwrapped[1];
              activationTimestamp = timestamp && typeof timestamp.toNumber === 'function' ? timestamp.toNumber() : null;
              eraIdFromTimestamp = eraIdx && typeof eraIdx.toNumber === 'function' ? eraIdx.toNumber() : null;
              isEraStart = activationTimestamp !== null;
              this.logger.info({ activationTimestamp, eraIdFromTimestamp }, 'Extracted from tuple');
            }
          }
        }
      } catch (e) {
        this.logger.debug({ error: e }, 'Error extracting activationTimestamp');
        activationTimestamp = null;
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
      if (isEraStart && activationTimestamp !== null && eraIdFromTimestamp !== null) {
        // Use the era_id from the activationTimestamp tuple
        eraId = eraIdFromTimestamp;

        if (eraId !== null) {

          // Update previous era's end session
          const previousEra = this.db.getLatestEra();
          if (previousEra && previousEra.sessionEnd === null) {
            this.db.upsertEra({
              ...previousEra,
              sessionEnd: sessionId, // Session that just ended when new era starts
            });
            this.logger.info({
              previousEraId: previousEra.eraId,
              sessionEnd: sessionId,
              newEraId: eraId
            }, 'Era transition: Updated previous era end session');
          }

          // Create new era (sessionId and eraId are guaranteed to be numbers here)
          this.db.upsertEra({
            eraId: eraId!,
            sessionStart: (sessionId as number) + 1,
            sessionEnd: null,
            startTime: activationTimestamp,
          });

          this.logger.info({
            eraId,
            sessionStart: sessionId + 1,
            startTime: activationTimestamp,
            previousEraEnded: previousEra ? sessionId : null
          }, 'New era created');
        }
      }

      // Query era information from Asset Hub at block n-1 for the ENDING session
      // This is because the event is received at block n, but the era info should be queried from n-1
      const queryBlockNumberForEndingSession = Math.max(1, blockNumber - 1);
      let activeEraIdForEndingSession: number | null = null;
      let plannedEraIdForEndingSession: number | null = null;

      try {
        const queryBlockHash = await this.apiAH.rpc.chain.getBlockHash(queryBlockNumberForEndingSession);
        const apiAt = await this.apiAH.at(queryBlockHash);

        // Get active era
        const activeEraOption = await apiAt.query.staking?.activeEra?.();
        this.logger.info({
          sessionId,
          queryBlockNumber: queryBlockNumberForEndingSession,
          hasActiveEra: !!activeEraOption,
          isEmpty: activeEraOption?.isEmpty,
          activeEraRaw: activeEraOption?.toString()
        }, 'Querying activeEra from Asset Hub for ending session');

        if (activeEraOption && !activeEraOption.isEmpty) {
          const activeEra = (activeEraOption as any).toJSON();
          activeEraIdForEndingSession = activeEra?.index || null;
          this.logger.info({ activeEra, activeEraId: activeEraIdForEndingSession }, 'Parsed activeEra for ending session');
        }

        // Get planned era (currentEra)
        const currentEraOption = await apiAt.query.staking?.currentEra?.();
        this.logger.info({
          sessionId,
          queryBlockNumber: queryBlockNumberForEndingSession,
          hasCurrentEra: !!currentEraOption,
          isEmpty: currentEraOption?.isEmpty,
          currentEraRaw: currentEraOption?.toString()
        }, 'Querying currentEra from Asset Hub for ending session');

        if (currentEraOption && !currentEraOption.isEmpty) {
          // currentEra returns a plain number codec, not an object like activeEra
          // Use toJSON() to get the numeric value
          const asAny = currentEraOption as any;
          plannedEraIdForEndingSession = typeof asAny.toJSON === 'function' ? asAny.toJSON() : null;
          this.logger.info({ plannedEraId: plannedEraIdForEndingSession }, 'Parsed currentEra for ending session');
        }
      } catch (e) {
        this.logger.error({ error: e, sessionId, queryBlockNumber: queryBlockNumberForEndingSession }, 'Error querying era info from Asset Hub for ending session');
      }

      // Create/update the ENDING session (sessionId = endIndex)
      this.db.upsertSession({
        sessionId,
        blockNumber,
        activationTimestamp,
        activeEraId: activeEraIdForEndingSession,
        plannedEraId: plannedEraIdForEndingSession,
        validatorPointsTotal: totalPoints,
      });

      this.logger.info({ sessionId, activeEraId: activeEraIdForEndingSession, plannedEraId: plannedEraIdForEndingSession, totalPoints }, 'Ending session created/updated');

      // Create the STARTING session (sessionId = endIndex + 1)
      // Query era information at block n (current block) for the starting session
      const nextSessionId = sessionId + 1;
      let activeEraIdForStartingSession: number | null = null;
      let plannedEraIdForStartingSession: number | null = null;

      try {
        const currentBlockHash = await this.apiAH.rpc.chain.getBlockHash(blockNumber);
        const apiAtCurrent = await this.apiAH.at(currentBlockHash);

        // Get active era for the starting session
        const activeEraOptionCurrent = await apiAtCurrent.query.staking?.activeEra?.();
        this.logger.info({
          sessionId: nextSessionId,
          queryBlockNumber: blockNumber,
          hasActiveEra: !!activeEraOptionCurrent,
          isEmpty: activeEraOptionCurrent?.isEmpty,
          activeEraRaw: activeEraOptionCurrent?.toString()
        }, 'Querying activeEra from Asset Hub for starting session');

        if (activeEraOptionCurrent && !activeEraOptionCurrent.isEmpty) {
          const activeEra = (activeEraOptionCurrent as any).toJSON();
          activeEraIdForStartingSession = activeEra?.index || null;
          this.logger.info({ activeEra, activeEraId: activeEraIdForStartingSession }, 'Parsed activeEra for starting session');
        }

        // Get planned era (currentEra) for the starting session
        const currentEraOptionCurrent = await apiAtCurrent.query.staking?.currentEra?.();
        this.logger.info({
          sessionId: nextSessionId,
          queryBlockNumber: blockNumber,
          hasCurrentEra: !!currentEraOptionCurrent,
          isEmpty: currentEraOptionCurrent?.isEmpty,
          currentEraRaw: currentEraOptionCurrent?.toString()
        }, 'Querying currentEra from Asset Hub for starting session');

        if (currentEraOptionCurrent && !currentEraOptionCurrent.isEmpty) {
          const asAny = currentEraOptionCurrent as any;
          plannedEraIdForStartingSession = typeof asAny.toJSON === 'function' ? asAny.toJSON() : null;
          this.logger.info({ plannedEraId: plannedEraIdForStartingSession }, 'Parsed currentEra for starting session');
        }
      } catch (e) {
        this.logger.error({ error: e, sessionId: nextSessionId, queryBlockNumber: blockNumber }, 'Error querying era info from Asset Hub for starting session');
      }

      // Create the STARTING session with partial data (will be completed when this session ends)
      this.db.upsertSession({
        sessionId: nextSessionId,
        blockNumber: null, // Will be filled when this session ends
        activationTimestamp: null, // Will be filled if this session starts a new era
        activeEraId: activeEraIdForStartingSession,
        plannedEraId: plannedEraIdForStartingSession,
        validatorPointsTotal: 0, // Will be filled when this session ends
      });

      this.logger.info({ sessionId: nextSessionId, activeEraId: activeEraIdForStartingSession, plannedEraId: plannedEraIdForStartingSession }, 'Starting session created');

    } catch (error) {
      this.logger.error({ error, blockNumber, eventType: 'SessionReportReceived' }, 'Error handling SessionReportReceived');
    }
  }

  /**
   * Handle PhaseTransitioned event to track election phases
   */
  private async handlePhaseTransitioned(event: any, blockNumber: number, blockTimestamp: number): Promise<void> {
    this.logger.info({ blockNumber }, 'Processing PhaseTransitioned event');

    try {
      // Get phase transition info
      // Extract phase names properly (handle enum variants with associated data)
      const extractPhaseName = (phaseData: any): string => {
        if (!phaseData) return '';

        // If it's an enum type, check for .type property
        if (phaseData.type) {
          return phaseData.type;
        }

        // If it's already a string, use it
        if (typeof phaseData === 'string') {
          return phaseData;
        }

        // If toString gives us JSON like {"export":14}, extract the key
        const str = phaseData.toString();
        if (str.startsWith('{')) {
          try {
            const parsed = JSON.parse(str);
            const keys = Object.keys(parsed);
            if (keys.length > 0) {
              // Capitalize first letter
              return keys[0].charAt(0).toUpperCase() + keys[0].slice(1);
            }
          } catch (e) {
            // Fall through
          }
        }

        return str;
      };

      const fromPhase = extractPhaseName(event.data.from);
      const toPhase = extractPhaseName(event.data.to);

      this.logger.info({ fromPhase, toPhase, blockNumber }, 'Phase transition detected');

      // Create API instance at this block
      const blockHash = await this.apiAH.rpc.chain.getBlockHash(blockNumber);
      const apiAt = await this.apiAH.at(blockHash);

      // Query round number
      const round = await apiAt.query.multiBlockElection?.round?.();
      const roundNumber = round && typeof (round as any).toNumber === 'function' ? (round as any).toNumber() : 0;

      // Query active era for era_id (the era during which this phase is occurring, not the era being elected for)
      const activeEraOption = await apiAt.query.staking?.activeEra?.();
      let eraId: number | null = null;

      if (activeEraOption && !activeEraOption.isEmpty) {
        const activeEra = (activeEraOption as any).toJSON();
        eraId = activeEra?.index || null;
      }

      if (!eraId) {
        this.logger.warn({ blockNumber }, 'Could not get era_id for election phase');
        return;
      }

      // Create event_id for Subscan linking
      const eventsCodec = await apiAt.query.system.events();
      const events = eventsCodec as unknown as EventRecord[];
      let eventIndex = 0;
      for (let i = 0; i < events.length; i++) {
        const record = events[i];
        const evt = record.event;
        const evtType = `${evt.section}.${evt.method}`;
        if (evtType.toLowerCase() === 'multiblockelection.phasetransitioned') {
          eventIndex = i;
          break;
        }
      }
      const eventId = `${blockNumber}-${eventIndex}`;

      let phaseData: any = {
        eraId,
        round: roundNumber,
        phase: toPhase,
        blockNumber,
        eventId,
        timestamp: blockTimestamp,
      };

      // Query phase-specific data
      if (toPhase === 'Snapshot') {
        // Query validator and nominator counts
        const validatorCount = await apiAt.query.staking?.counterForValidators?.();
        const nominatorCount = await apiAt.query.staking?.counterForNominators?.();
        const targetValidatorCount = await apiAt.query.staking?.validatorCount?.();

        phaseData.validatorCandidates = validatorCount && typeof (validatorCount as any).toNumber === 'function' ? (validatorCount as any).toNumber() : null;
        phaseData.nominatorCandidates = nominatorCount && typeof (nominatorCount as any).toNumber === 'function' ? (nominatorCount as any).toNumber() : null;
        phaseData.targetValidatorCount = targetValidatorCount && typeof (targetValidatorCount as any).toNumber === 'function' ? (targetValidatorCount as any).toNumber() : null;

        this.logger.info({
          validatorCandidates: phaseData.validatorCandidates,
          nominatorCandidates: phaseData.nominatorCandidates,
          targetValidatorCount: phaseData.targetValidatorCount
        }, 'Snapshot phase data');
      }

      if (toPhase === 'Signed') {
        // Query sorted scores and minimum score
        const sortedScoresCodec = await apiAt.query.multiBlockElectionSigned?.sortedScores?.(roundNumber);
        const minimumScoreCodec = await apiAt.query.multiBlockElectionVerifier?.minimumScore?.();

        if (sortedScoresCodec) {
          const sortedScores = sortedScoresCodec.toJSON();
          // Get top 5 scores
          const top5 = Array.isArray(sortedScores) ? sortedScores.slice(0, 5) : [];
          phaseData.sortedScores = JSON.stringify(top5);
        }

        if (minimumScoreCodec && !minimumScoreCodec.isEmpty) {
          phaseData.minimumScore = minimumScoreCodec.toString();
        }

        this.logger.info({ sortedScores: phaseData.sortedScores, minimumScore: phaseData.minimumScore }, 'Signed phase data');
      }

      if (toPhase === 'SignedValidation') {
        // Query queued solution score
        const queuedScoreCodec = await apiAt.query.multiBlockElectionVerifier?.queuedSolutionScore?.(roundNumber);

        if (queuedScoreCodec && !queuedScoreCodec.isEmpty) {
          phaseData.queuedSolutionScore = queuedScoreCodec.toString();
        }

        this.logger.info({ queuedSolutionScore: phaseData.queuedSolutionScore }, 'SignedValidation phase data');
      }

      if (toPhase === 'Off' && fromPhase === 'Export') {
        // Query elected validators at block n-1
        const queryBlockNumber = Math.max(1, blockNumber - 1);
        const queryBlockHash = await this.apiAH.rpc.chain.getBlockHash(queryBlockNumber);
        const apiAtQuery = await this.apiAH.at(queryBlockHash);

        const electableStashes = await apiAtQuery.query.staking?.electableStashes?.();

        if (electableStashes) {
          const stashesList = electableStashes.toJSON();
          phaseData.validatorsElected = Array.isArray(stashesList) ? stashesList.length : 0;

          // Also update the era table
          this.db.updateEraValidatorCount(eraId, phaseData.validatorsElected);
        }

        this.logger.info({ validatorsElected: phaseData.validatorsElected }, 'Export→Off transition data');
      }

      // Check if era exists before inserting (to avoid foreign key constraint)
      const existingEra = this.db.getEra(eraId);
      if (!existingEra) {
        this.logger.warn({
          eraId,
          phase: toPhase,
          blockNumber,
          message: 'Era does not exist yet, skipping election phase insert. Will be populated when era is created.'
        }, 'Skipping election phase - era not found');
      } else {
        // Insert election phase
        this.db.insertElectionPhase(phaseData);
        this.logger.info({ phase: toPhase, eraId, round: roundNumber }, 'Inserted election phase');
      }

    } catch (error) {
      this.logger.error({ error, blockNumber, eventType: 'PhaseTransitioned' }, 'Error handling PhaseTransitioned');
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

    if (this.gapFillerInterval) {
      clearInterval(this.gapFillerInterval);
      this.gapFillerInterval = null;
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
