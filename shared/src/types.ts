// Chain types
export type ChainType = 'polkadot' | 'kusama' | 'westend';
export type ChainLayer = 'relayChain' | 'assetHub';

// Block types
export interface Block {
  blockNumber: number;
  timestamp: number;
}

// Event types - now includes event_id for Subscan linking
export interface BlockchainEvent {
  id?: number;
  blockNumber: number;
  eventId: string; // Format: blockNumber-eventIndex for Subscan linking
  eventType: string; // section.method (e.g., "stakingRelaychainClient.SessionReportReceived")
  data: string; // JSON stringified event data
}

// Session types (Asset Hub only)
export interface Session {
  sessionId: number;
  blockNumber: number; // FK to Blocks_AH
  activationTimestamp: number | null; // From event data
  eraId: number | null; // FK to Eras
  validatorPointsTotal: number;
}

// Era types
export interface Era {
  eraId: number;
  sessionStart: number; // end_index + 1 from SessionReportReceived
  sessionEnd: number | null; // Set when next era is created
  startTime: number; // activation_timestamp from event
}

// Warning types (for later)
export type WarningType = 'timing' | 'missing_event' | 'unexpected_event' | 'election_issue';
export type WarningSeverity = 'info' | 'warning' | 'error';

export interface Warning {
  id?: number;
  eraId: number | null;
  sessionId: number | null;
  blockNumber: number;
  type: WarningType;
  message: string;
  severity: WarningSeverity;
  timestamp: number;
}

// RPC Configuration
export interface RpcEndpointConfig {
  relayChain: string[];
  assetHub: string[];
}

export interface RpcConfig {
  polkadot: RpcEndpointConfig;
  kusama: RpcEndpointConfig;
}

// API Response types
export interface ApiStatus {
  chain: ChainType;
  currentEra: number | null;
  currentSession: number | null;
  lastBlockRC: number;
  lastBlockAH: number;
  lastUpdateTime: number;
  rpcEndpointRC: string;
  rpcEndpointAH: string;
  isConnectedRC: boolean;
  isConnectedAH: boolean;
  syncProgressRC?: {
    target: number;
    current: number;
    percentage: number;
  };
  syncProgressAH?: {
    target: number;
    current: number;
    percentage: number;
  };
}

export interface EraDetails extends Era {
  sessions: Session[];
  warnings: Warning[];
}

// WebSocket event types for real-time updates
export type WsEventType =
  | 'era_update'
  | 'session_update'
  | 'election_phase_change'
  | 'new_warning'
  | 'block_update'
  | 'connection_status';

export interface WsEvent<T = any> {
  type: WsEventType;
  data: T;
  timestamp: number;
}

// Database types
export interface DatabaseConfig {
  filename: string;
  maxEras: number;
}

// Indexer configuration
export type IndexerMode = 'dev' | 'prod';

export interface IndexerConfig {
  mode: IndexerMode;
  backfillBlocks: number; // 10 for dev, 15000 for prod
}

// Indexer state
export interface IndexerState {
  lastProcessedBlockRC: number;
  lastProcessedBlockAH: number;
  currentEra: number | null;
  currentSession: number | null;
  isProcessingRC: boolean;
  isProcessingAH: boolean;
  errorCount: number;
  lastError: string | null;
}
