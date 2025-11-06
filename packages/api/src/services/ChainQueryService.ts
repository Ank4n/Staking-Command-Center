import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Logger } from 'pino';

export class ChainQueryService {
  private apiAH: ApiPromise | null = null;
  private logger: Logger;
  private rpcEndpoint: string;
  private isConnecting: boolean = false;

  constructor(rpcEndpoint: string, logger: Logger) {
    this.rpcEndpoint = rpcEndpoint;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.apiAH || this.isConnecting) return;

    this.isConnecting = true;
    try {
      this.logger.info({ endpoint: this.rpcEndpoint }, 'Connecting to Asset Hub for chain queries');
      const provider = new WsProvider(this.rpcEndpoint);
      this.apiAH = await ApiPromise.create({ provider });
      await this.apiAH.isReady;
      this.logger.info('Connected to Asset Hub');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Asset Hub');
      this.apiAH = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.apiAH) {
      await this.apiAH.disconnect();
      this.apiAH = null;
      this.logger.info('Disconnected from Asset Hub');
    }
  }

  async queryMinimumScore(): Promise<string | null> {
    if (!this.apiAH) {
      await this.connect();
    }

    if (!this.apiAH) {
      throw new Error('Failed to connect to Asset Hub');
    }

    try {
      const minimumScoreOption = await this.apiAH.query.multiBlockElectionVerifier?.minimumScore?.();

      if (!minimumScoreOption) {
        this.logger.warn('multiBlockElectionVerifier.minimumScore not available on chain');
        return null;
      }

      if (minimumScoreOption.isEmpty) {
        return null;
      }

      // The minimum score is an ElectionScore object with { minimalStake, sumStake, sumStakeSquared }
      const score = (minimumScoreOption as any).toJSON();

      if (score && typeof score === 'object') {
        // Return as JSON string with all three components
        return JSON.stringify({
          minimalStake: score.minimalStake?.toString() || '0',
          sumStake: score.sumStake?.toString() || '0',
          sumStakeSquared: score.sumStakeSquared?.toString() || '0'
        });
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Error querying minimum score');
      throw error;
    }
  }
}
