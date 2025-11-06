import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import dotenv from 'dotenv';
import pinoHttp from 'pino-http';
import { DatabaseClient } from './database/DatabaseClient';
import { createRouter } from './routes';
import { WebSocketManager } from './websocket/WebSocketManager';
import { ChainQueryService } from './services/ChainQueryService';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Find project root by looking for package.json with workspaces
function findProjectRoot(): string {
  let currentDir = __dirname;
  while (currentDir !== '/') {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.workspaces) {
          return currentDir;
        }
      } catch (e) {
        // Continue searching
      }
    }
    currentDir = path.dirname(currentDir);
  }
  return process.cwd();
}

// Load .env from project root
const projectRoot = findProjectRoot();
dotenv.config({ path: path.join(projectRoot, '.env') });

const API_PORT = parseInt(process.env.API_PORT || '4000', 10);
const API_HOST = process.env.API_HOST || '0.0.0.0';
const CHAIN = process.env.CHAIN || 'kusama';
const RPC_ENDPOINT_AH = process.env.RPC_ENDPOINT_AH || 'wss://kusama-asset-hub-rpc.polkadot.io';

// Resolve DB path relative to project root
// Use chain-specific database file (same as indexer)
const dbPathEnv = process.env.DB_PATH || `./data/staking-${CHAIN}.db`;
const DB_PATH = path.isAbsolute(dbPathEnv)
  ? dbPathEnv
  : path.join(projectRoot, dbPathEnv);

async function waitForDatabase(maxWaitMs: number = 60000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 2000; // Check every 2 seconds

  logger.info({ dbPath: DB_PATH }, 'Waiting for database to be created by indexer...');

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(DB_PATH)) {
      // Wait an additional second to ensure database is fully initialized
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info({ dbPath: DB_PATH }, 'Database found!');
      return;
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    logger.debug({ elapsed, maxWait: Math.floor(maxWaitMs / 1000) }, 'Still waiting for database...');
  }

  throw new Error(`Database not found after ${maxWaitMs / 1000}s. Please ensure the indexer is running.`);
}

async function main() {
  try {
    logger.info('Starting Staking Command Center API Server');

    // Wait for database to be created by indexer (if needed)
    if (!fs.existsSync(DB_PATH)) {
      await waitForDatabase();
    }

    // Initialize database client
    const db = new DatabaseClient(DB_PATH);
    logger.info({ dbPath: DB_PATH }, 'Database client initialized');

    // Initialize chain query service
    const chainQueryService = new ChainQueryService(RPC_ENDPOINT_AH, logger);
    try {
      await chainQueryService.connect();
    } catch (error) {
      logger.warn({ error }, 'Failed to connect to chain, some features may be unavailable');
    }

    // Create Express app
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json());
    app.use(pinoHttp({ logger }));

    // API routes
    const apiRouter = createRouter(db, chainQueryService);
    app.use('/api', apiRouter);

    // Serve frontend static files (production mode)
    const frontendPath = path.join(__dirname, '../../frontend/dist');
    if (fs.existsSync(frontendPath)) {
      logger.info({ frontendPath }, 'Serving frontend static files');

      // Serve static files
      app.use(express.static(frontendPath));

      // SPA fallback - serve index.html for all non-API routes
      app.get('*', (req, res) => {
        res.sendFile(path.join(frontendPath, 'index.html'));
      });
    } else {
      logger.info('Frontend dist folder not found, API-only mode');

      // Root endpoint (API-only mode)
      app.get('/', (req, res) => {
        res.json({
          name: 'Staking Command Center API',
          version: '0.1.0',
          chain: process.env.CHAIN || 'unknown',
          endpoints: {
            health: '/api/health',
            status: '/api/status',
            eras: '/api/eras',
            warnings: '/api/warnings',
            docs: 'See README.md for full API documentation',
          },
        });
      });
    }

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize WebSocket manager
    const wsManager = new WebSocketManager(httpServer, db, DB_PATH, logger);
    logger.info('WebSocket manager initialized');

    // Start server
    httpServer.listen(API_PORT, API_HOST, () => {
      logger.info({ port: API_PORT, host: API_HOST }, 'API server listening');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        wsManager.stop();
        await chainQueryService.disconnect();
        db.close();
        httpServer.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });

        // Force exit after 10 seconds
        setTimeout(() => {
          logger.error('Forced shutdown after timeout');
          process.exit(1);
        }, 10000);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error({ error }, 'Fatal error in main');
    process.exit(1);
  }
}

main();
