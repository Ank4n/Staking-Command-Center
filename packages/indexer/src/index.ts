import { RpcManager } from './rpc';
import { StakingDatabase } from './database';
import { Indexer } from './indexer/Indexer';
import { loadConfig } from './utils/config';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  try {
    console.log('DEBUG: Main function started');
    logger.info('Starting Staking Command Center Indexer');

    // Load configuration
    console.log('DEBUG: About to load config');
    const config = loadConfig();
    console.log('DEBUG: Config loaded:', config);
    logger.info({ chain: config.chain }, 'Configuration loaded');

    // Ensure data directory exists
    const dataDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info({ dataDir }, 'Created data directory');
    }

    // Initialize database
    const db = new StakingDatabase(config.dbPath, logger, config.maxEras);
    logger.info({ dbPath: config.dbPath }, 'Database initialized');

    // Initialize RPC connection with failover
    const rpcManager = new RpcManager(
      config.chain,
      'relayChain',
      logger,
      config.customRpcEndpoint
    );

    logger.info('Connecting to RPC endpoint...');
    const api = await rpcManager.connect();
    logger.info({ endpoint: rpcManager.getCurrentEndpoint() }, 'Connected to RPC');

    // Get chain info
    const chain = await api.rpc.system.chain();
    const version = await api.rpc.system.version();
    logger.info({ chain: chain.toString(), version: version.toString() }, 'Chain info');

    // Initialize and start indexer
    const indexer = new Indexer(api, db, logger);
    await indexer.start();

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        await indexer.stop();
        await rpcManager.disconnect();
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
