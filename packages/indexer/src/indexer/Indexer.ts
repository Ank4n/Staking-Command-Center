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
  private gapFillerInterval: NodeJS.Timeout | null = null;

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
