import dotenv from 'dotenv';
import type { ChainType } from '@staking-cc/shared';
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
  syncBlocks: number;
  dbPath: string;
  maxEras: number;
  customRpcEndpoint?: string;
}

export function loadConfig(): Config {
  const chain = process.env.CHAIN as ChainType;

  if (!chain || (chain !== 'polkadot' && chain !== 'kusama' && chain !== 'westend')) {
    throw new Error('CHAIN must be set to "polkadot", "kusama", or "westend"');
  }

  // Sync blocks: how many blocks back from current height to sync (defaults to 10)
  const syncBlocks = parseInt(process.env.SYNC_BLOCKS || '10', 10);

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
    syncBlocks,
    dbPath,
    maxEras,
    customRpcEndpoint,
  };
}
