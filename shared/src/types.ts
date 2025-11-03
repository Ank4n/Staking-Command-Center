// Chain types
export type ChainType = 'polkadot' | 'kusama';
export type ChainLayer = 'relayChain' | 'assetHub';

// Era and Session types
export interface Era {
  eraIndex: number;
  startSession: number | null;
  endSession: number | null;
  startTime: number | null;
  endTime: number | null;
  totalValidators: number | null;
  totalNominators: number | null;
  inflationAmount: string | null;
}

export interface Session {
  sessionIndex: number;
  eraIndex: number | null;
  startBlock: number;
  startTime: number;
  validatorCount: number | null;
  pointsTotal: number | null;
}

// Election types
export type ElectionPhase = 'off' | 'signed' | 'unsigned' | 'emergency' | 'snapshot';

export interface ElectionPhaseRecord {
  id?: number;
  eraIndex: number;
  phase: ElectionPhase;
  startBlock: number;
  endBlock: number | null;
  startTime: number;
  endTime: number | null;
}

export interface ValidatorPoints {
  id?: number;
  sessionIndex: number;
  validatorAddress: string;
  points: number;
}

// Warning types
export type WarningType = 'timing' | 'missing_event' | 'unexpected_event' | 'election_issue';
export type WarningSeverity = 'info' | 'warning' | 'error';

export interface Warning {
  id?: number;
  eraIndex: number | null;
  sessionIndex: number | null;
  blockNumber: number;
  type: WarningType;
  message: string;
  severity: WarningSeverity;
  timestamp: number;
}

// Event types
export interface BlockchainEvent {
  id?: number;
  blockNumber: number;
  eraIndex: number | null;
  sessionIndex: number | null;
  eventType: string;
  data: string; // JSON stringified
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
  activeValidators: number | null;
  electionPhase: ElectionPhase | null;
  lastBlock: number;
  lastUpdateTime: number;
  rpcEndpoint: string;
  isConnected: boolean;
}

export interface EraDetails extends Era {
  sessions: Session[];
  electionPhases: ElectionPhaseRecord[];
  warnings: Warning[];
  unclaimedRewards?: number;
}

export interface ValidatorInfo {
  address: string;
  totalPoints: number;
  sessions: {
    sessionIndex: number;
    points: number;
  }[];
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

// Indexer state
export interface IndexerState {
  lastProcessedBlock: number;
  currentEra: number | null;
  currentSession: number | null;
  isProcessing: boolean;
  errorCount: number;
  lastError: string | null;
}
