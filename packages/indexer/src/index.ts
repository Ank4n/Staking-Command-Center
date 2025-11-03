import { RpcManager } from './rpc';
import { StakingDatabase } from './database';
import { Indexer } from './indexer/Indexer';
import { loadConfig } from './utils/config';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  try {
    logger.info('Starting Staking Command Center Indexer');

    // Load configuration
    const config = loadConfig();
    logger.info({ chain: config.chain, syncBlocks: config.syncBlocks }, 'Configuration loaded');

    // Ensure data directory exists
    const dataDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info({ dataDir }, 'Created data directory');
    }

    // Initialize database
    const db = new StakingDatabase(config.dbPath, logger, config.maxEras);
    logger.info({ dbPath: config.dbPath }, 'Database initialized');

    // Initialize RPC connections for both Relay Chain and Asset Hub
    logger.info('Connecting to Relay Chain...');
    const rpcManagerRC = new RpcManager(
      config.chain,
      'relayChain',
      logger,
      config.customRpcEndpoint
    );
    const apiRC = await rpcManagerRC.connect();
    logger.info({ endpoint: rpcManagerRC.getCurrentEndpoint() }, 'Connected to Relay Chain');

    logger.info('Connecting to Asset Hub...');
    const rpcManagerAH = new RpcManager(
      config.chain,
      'assetHub',
      logger
    );
    const apiAH = await rpcManagerAH.connect();
    logger.info({ endpoint: rpcManagerAH.getCurrentEndpoint() }, 'Connected to Asset Hub');

    // Get chain info for both chains
    const chainRC = await apiRC.rpc.system.chain();
    const versionRC = await apiRC.rpc.system.version();
    logger.info({ chain: chainRC.toString(), version: versionRC.toString() }, 'Relay Chain info');

    const chainAH = await apiAH.rpc.system.chain();
    const versionAH = await apiAH.rpc.system.version();
    logger.info({ chain: chainAH.toString(), version: versionAH.toString() }, 'Asset Hub info');

    // Initialize and start indexer for both chains
    const indexer = new Indexer(apiRC, apiAH, db, logger, config.syncBlocks);
    await indexer.start();

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        await indexer.stop();
        await rpcManagerRC.disconnect();
        await rpcManagerAH.disconnect();
        db.close();

        logger.info('Shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Keep process alive
    logger.info('Indexer is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, 'Fatal error in main');
    console.error('Full error:', error);
    process.exit(1);
  }
}

main();
