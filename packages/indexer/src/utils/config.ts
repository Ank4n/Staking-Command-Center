import dotenv from 'dotenv';
import type { ChainType, IndexerMode } from '@staking-cc/shared';
import * as path from 'path';
import * as fs from 'fs';

// Find project root by looking for package.json with workspaces
function findProjectRoot(): string {
  let currentDir = __dirname;
  while (currentDir !== '/') {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.workspaces) {
        return currentDir;
      }
    }
    currentDir = path.dirname(currentDir);
  }
  // Fallback to current working directory
  return process.cwd();
}

// Load .env from project root
const projectRoot = findProjectRoot();
dotenv.config({ path: path.join(projectRoot, '.env') });

export interface Config {
  chain: ChainType;
  mode: IndexerMode;
  backfillBlocks: number;
  dbPath: string;
  maxEras: number;
  customRpcEndpoint?: string;
}

export function loadConfig(): Config {
  const chain = process.env.CHAIN as ChainType;

  if (!chain || (chain !== 'polkadot' && chain !== 'kusama' && chain !== 'westend')) {
    throw new Error('CHAIN must be set to "polkadot", "kusama", or "westend"');
  }

  // Mode: dev or prod (defaults to dev)
  const mode = (process.env.INDEXER_MODE || 'dev') as IndexerMode;
  if (mode !== 'dev' && mode !== 'prod') {
    throw new Error('INDEXER_MODE must be either "dev" or "prod"');
  }

  // Backfill blocks: 10 for dev, 15000 for prod
  const backfillBlocks = mode === 'dev' ? 10 : 15000;

  // Resolve DB path relative to project root
  // Each chain gets its own database file
  const dbPathEnv = process.env.DB_PATH || `./data/staking-${chain}.db`;
  const dbPath = path.isAbsolute(dbPathEnv)
    ? dbPathEnv
    : path.join(projectRoot, dbPathEnv);

  const maxEras = parseInt(process.env.MAX_ERAS || '100', 10);
  const customRpcEndpoint = process.env.CUSTOM_RPC_ENDPOINT;

  return {
    chain,
    mode,
    backfillBlocks,
    dbPath,
    maxEras,
    customRpcEndpoint,
  };
}
