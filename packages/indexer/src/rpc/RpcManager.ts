import { ApiPromise, WsProvider } from '@polkadot/api';
import type { ChainType, ChainLayer } from '@staking-cc/shared';
import type { Logger } from 'pino';
import rpcConfig from '../../../../config/rpc-endpoints.json';

interface RpcEndpointStatus {
  url: string;
  lastAttempt: number;
  consecutiveFailures: number;
  isHealthy: boolean;
}

export class RpcManager {
  private chain: ChainType;
  private layer: ChainLayer;
  private endpoints: string[];
  private currentEndpointIndex: number = 0;
  private endpointStatus: Map<string, RpcEndpointStatus> = new Map();
  private api: ApiPromise | null = null;
  private provider: WsProvider | null = null;
  private logger: Logger;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Configuration
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly FAILURE_COOLDOWN_MS = 60000; // 1 minute
  private readonly HEALTH_CHECK_INTERVAL_MS = 300000; // 5 minutes
  private readonly CONNECTION_TIMEOUT_MS = 30000; // 30 seconds

  constructor(chain: ChainType, layer: ChainLayer, logger: Logger, customEndpoint?: string) {
    this.chain = chain;
    this.layer = layer;
    this.logger = logger.child({ component: 'RpcManager', chain, layer });

    // Load endpoints from config or use custom
    if (customEndpoint) {
      this.endpoints = [customEndpoint];
    } else {
      this.endpoints = rpcConfig[chain][layer];
    }

    if (!this.endpoints || this.endpoints.length === 0) {
      throw new Error(`No RPC endpoints configured for ${chain} ${layer}`);
    }

    // Initialize endpoint status
    this.endpoints.forEach(url => {
      this.endpointStatus.set(url, {
        url,
        lastAttempt: 0,
        consecutiveFailures: 0,
        isHealthy: true,
      });
    });

    this.logger.info(`Initialized with ${this.endpoints.length} endpoints`);
  }

  /**
   * Connect to an RPC endpoint with automatic failover
   */
  async connect(): Promise<ApiPromise> {
    const maxAttempts = this.endpoints.length * 2; // Try each endpoint twice
    let attempts = 0;

    while (attempts < maxAttempts) {
      const endpoint = this.selectNextEndpoint();

      if (!endpoint) {
        this.logger.error('No healthy endpoints available');
        await this.sleep(5000); // Wait before retry
        this.resetEndpointHealth(); // Reset all endpoints
        attempts++;
        continue;
      }

      try {
        this.logger.info(`Connecting to ${endpoint}...`);
        const api = await this.connectToEndpoint(endpoint);

        this.api = api;
        this.markEndpointHealthy(endpoint);
        this.startHealthCheck();

        this.logger.info(`Successfully connected to ${endpoint}`);
        return api;
      } catch (error) {
        this.logger.warn({ error, endpoint }, `Failed to connect to ${endpoint}`);
        this.markEndpointUnhealthy(endpoint);
        attempts++;
      }
    }

    throw new Error('Failed to connect to any RPC endpoint after maximum attempts');
  }

  /**
   * Connect to a specific endpoint
   */
  private async connectToEndpoint(endpoint: string): Promise<ApiPromise> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (provider) {
          provider.disconnect();
        }
        reject(new Error(`Connection timeout after ${this.CONNECTION_TIMEOUT_MS}ms`));
      }, this.CONNECTION_TIMEOUT_MS);

      const provider = new WsProvider(endpoint);
      this.provider = provider;

      // Setup error handlers
      provider.on('error', (error) => {
        this.logger.debug({ error, endpoint }, 'WebSocket error');
      });

      provider.on('disconnected', () => {
        this.logger.warn({ endpoint }, 'WebSocket disconnected');
        this.handleDisconnection();
      });

      // Create API instance
      ApiPromise.create({ provider })
        .then(async (api) => {
          clearTimeout(timeout);

          // Wait for the API to be ready
          await api.isReady;

          resolve(api);
        })
        .catch((error) => {
          clearTimeout(timeout);
          provider.disconnect();
          reject(error);
        });
    });
  }

  /**
   * Select the next healthy endpoint to try
   */
  private selectNextEndpoint(): string | null {
    const now = Date.now();
    const healthyEndpoints = this.endpoints.filter(url => {
      const status = this.endpointStatus.get(url)!;

      // Skip if recently failed and still in cooldown
      if (status.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        if (now - status.lastAttempt < this.FAILURE_COOLDOWN_MS) {
          return false;
        }
        // Reset after cooldown
        status.consecutiveFailures = 0;
        status.isHealthy = true;
      }

      return status.isHealthy;
    });

    if (healthyEndpoints.length === 0) {
      return null;
    }

    // Round-robin through healthy endpoints
    const endpoint = healthyEndpoints[this.currentEndpointIndex % healthyEndpoints.length];
    this.currentEndpointIndex++;

    const status = this.endpointStatus.get(endpoint)!;
    status.lastAttempt = now;

    return endpoint;
  }

  /**
   * Mark an endpoint as healthy
   */
  private markEndpointHealthy(endpoint: string): void {
    const status = this.endpointStatus.get(endpoint);
    if (status) {
      status.isHealthy = true;
      status.consecutiveFailures = 0;
      this.logger.debug({ endpoint }, 'Endpoint marked healthy');
    }
  }

  /**
   * Mark an endpoint as unhealthy
   */
  private markEndpointUnhealthy(endpoint: string): void {
    const status = this.endpointStatus.get(endpoint);
    if (status) {
      status.consecutiveFailures++;
      status.isHealthy = status.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;
      this.logger.debug(
        { endpoint, failures: status.consecutiveFailures },
        'Endpoint marked unhealthy'
      );
    }
  }

  /**
   * Reset all endpoints to healthy (after all have failed)
   */
  private resetEndpointHealth(): void {
    this.endpointStatus.forEach(status => {
      status.isHealthy = true;
      status.consecutiveFailures = 0;
    });
    this.logger.info('Reset all endpoint health status');
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private async handleDisconnection(): Promise<void> {
    if (this.reconnectTimer) {
      return; // Already reconnecting
    }

    this.logger.warn('Connection lost, attempting to reconnect...');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        if (this.api) {
          await this.api.disconnect();
        }
        await this.connect();
      } catch (error) {
        this.logger.error({ error }, 'Reconnection failed');
        // Will retry via health check
      }
    }, 5000); // Wait 5 seconds before reconnecting
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      if (!this.api || !this.api.isConnected) {
        this.logger.warn('Health check failed: not connected');
        this.handleDisconnection();
      } else {
        this.logger.debug('Health check passed');
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Get the current API instance
   */
  getApi(): ApiPromise {
    if (!this.api) {
      throw new Error('Not connected to any RPC endpoint');
    }
    return this.api;
  }

  /**
   * Get the current endpoint URL
   */
  getCurrentEndpoint(): string {
    if (!this.provider) {
      return 'not connected';
    }
    return this.provider.endpoint;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.api !== null && this.api.isConnected;
  }

  /**
   * Disconnect from the current endpoint
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.api) {
      await this.api.disconnect();
      this.api = null;
    }

    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
    }

    this.logger.info('Disconnected');
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
