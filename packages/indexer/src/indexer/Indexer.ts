import type { ApiPromise } from '@polkadot/api';
import type { Header, EventRecord } from '@polkadot/types/interfaces';
import type { Logger } from 'pino';
import type { StakingDatabase } from '../database';
import { EventProcessor } from '../processors/EventProcessor';

export class Indexer {
  private api: ApiPromise;
  private db: StakingDatabase;
  private logger: Logger;
  private eventProcessor: EventProcessor;
  private isRunning: boolean = false;
  private unsubscribe: (() => void) | null = null;

  constructor(api: ApiPromise, db: StakingDatabase, logger: Logger) {
    this.api = api;
    this.db = db;
    this.logger = logger.child({ component: 'Indexer' });
    this.eventProcessor = new EventProcessor(api, db, logger);
  }

  /**
   * Start indexing blocks
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Indexer already running');
      return;
    }

    this.logger.info('Starting indexer...');

    try {
      // Sync initial state
      await this.eventProcessor.syncState();

      // Get current finalized block
      const finalizedHead = await this.api.rpc.chain.getFinalizedHead();
      const finalizedHeader = await this.api.rpc.chain.getHeader(finalizedHead);
      const currentBlock = finalizedHeader.number.toNumber();

      this.logger.info({ currentBlock }, 'Current finalized block');

      // Determine starting block for backfill
      const lastBlockStr = this.db.getState('lastProcessedBlock');
      let startBlock: number;

      if (lastBlockStr) {
        // Resume from last processed block
        const lastProcessedBlock = parseInt(lastBlockStr, 10);
        startBlock = lastProcessedBlock + 1;
        this.logger.info({ lastProcessedBlock, startBlock }, 'Resuming from last processed block');
      } else {
        // Initial start: go back 250 blocks (most public RPC nodes keep ~256 blocks of state)
        const INITIAL_BACKFILL_BLOCKS = 250;
        startBlock = Math.max(1, currentBlock - INITIAL_BACKFILL_BLOCKS);
        this.logger.info({ startBlock, blocksBack: INITIAL_BACKFILL_BLOCKS }, 'Initial start: backfilling from past blocks');
      }

      // Process all blocks from start to current
      if (startBlock < currentBlock) {
        await this.catchUp(startBlock, currentBlock);
      } else if (startBlock === currentBlock) {
        this.logger.info('Already caught up, processing current block');
        await this.processBlockByNumber(currentBlock);
      }

      // Subscribe to new finalized blocks
      this.isRunning = true;
      this.subscribeToNewBlocks();

      this.logger.info('Indexer started successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start indexer');
      throw error;
    }
  }

  /**
   * Catch up with missed blocks
   */
  private async catchUp(fromBlock: number, toBlock: number): Promise<void> {
    const totalBlocks = toBlock - fromBlock + 1;
    this.logger.info({ fromBlock, toBlock, totalBlocks }, 'Catching up with missed blocks');

    // Process blocks in batches to avoid overwhelming the system
    const BATCH_SIZE = 100;
    let processed = 0;

    for (let i = fromBlock; i <= toBlock; i++) {
      try {
        await this.processBlockByNumber(i);
        processed++;

        if (processed % BATCH_SIZE === 0) {
          this.logger.info({ processed, total: totalBlocks, progress: `${((processed / totalBlocks) * 100).toFixed(1)}%` }, 'Catch-up progress');
        }
      } catch (error) {
        this.logger.error({ error, blockNumber: i }, 'Error processing block during catch-up');
        // Continue with next block
      }
    }

    this.logger.info({ processed, total: totalBlocks }, 'Catch-up completed');
  }

  /**
   * Subscribe to new finalized blocks
   */
  private subscribeToNewBlocks(): void {
    this.logger.info('Subscribing to new finalized blocks');

    this.unsubscribe = this.api.rpc.chain.subscribeFinalizedHeads(async (header: Header) => {
      const blockNumber = header.number.toNumber();
      const blockHash = header.hash.toHex();

      try {
        await this.processBlock(blockNumber, blockHash, header);
      } catch (error) {
        this.logger.error({ error, blockNumber, blockHash }, 'Error processing new block');
      }
    }) as unknown as () => void;
  }

  /**
   * Process a block by its number
   */
  private async processBlockByNumber(blockNumber: number): Promise<void> {
    const blockHash = await this.api.rpc.chain.getBlockHash(blockNumber);
    const header = await this.api.rpc.chain.getHeader(blockHash);

    await this.processBlock(blockNumber, blockHash.toHex(), header);
  }

  /**
   * Process a single block
   */
  private async processBlock(blockNumber: number, blockHash: string, header: Header): Promise<void> {
    // Check if already processed
    const lastProcessed = this.db.getState('lastProcessedBlock');
    if (lastProcessed && parseInt(lastProcessed, 10) >= blockNumber) {
      return;
    }

    this.logger.debug({ blockNumber, blockHash }, 'Processing block');

    try {
      // Get block events
      const apiAt = await this.api.at(blockHash);
      const events = await apiAt.query.system.events();

      // Get block timestamp
      const timestamp = await apiAt.query.timestamp.now();
      const blockTimestamp = (timestamp as any).toNumber();

      // Process events
      await this.eventProcessor.processBlockEvents(
        blockNumber,
        blockHash,
        events as unknown as EventRecord[],
        blockTimestamp
      );

      // Update last processed block
      this.db.setState('lastProcessedBlock', blockNumber.toString());

      // Log progress periodically
      if (blockNumber % 100 === 0) {
        const stats = this.db.getStats();
        this.logger.info({ blockNumber, ...stats }, 'Block processing progress');
      }
    } catch (error) {
      this.logger.error({ error, blockNumber, blockHash }, 'Error processing block');
      throw error;
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

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
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
