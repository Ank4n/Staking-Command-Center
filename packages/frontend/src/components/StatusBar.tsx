import type { ApiStatus, SyncStatus } from '@staking-cc/shared';

interface StatusBarProps {
  status: ApiStatus | null;
  isConnected: boolean;
}

const getSyncStatusDisplay = (syncStatus: SyncStatus): { text: string; className: string } => {
  switch (syncStatus) {
    case 'syncing':
      return { text: 'Syncing', className: 'syncing' };
    case 'in-sync':
      return { text: 'In Sync', className: 'connected' };
    case 'out-of-sync':
      return { text: 'Out of Sync', className: 'disconnected' };
  }
};

const formatTimestamp = (timestamp: number): string => {
  if (timestamp === 0) return 'Never';
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;

  // If less than 1 minute ago
  if (diff < 60000) {
    return 'Just now';
  }
  // If less than 1 hour ago
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }
  // Otherwise show time
  return date.toLocaleTimeString();
};

export const StatusBar: React.FC<StatusBarProps> = ({ status, isConnected }) => {
  if (!status) {
    return (
      <div className="status-bar">
        <div className="status-card">
          <div className="label">Loading...</div>
        </div>
      </div>
    );
  }

  const rcStatus = getSyncStatusDisplay(status.relayChain.status);
  const ahStatus = getSyncStatusDisplay(status.assetHub.status);

  return (
    <>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'API Connected' : 'API Disconnected'}
        </div>
        <div style={{ fontSize: '0.9rem', color: '#888' }}>
          Chain: {status.chain.toUpperCase()}
        </div>
      </div>

      <div className="status-bar">
        <div className="status-card">
          <div className="label">Current Era</div>
          <div className="value">{status.currentEra || '—'}</div>
          <div className="subvalue">Session {status.currentSession || '—'}</div>
        </div>

        <div className="status-card">
          <div className="label">Relay Chain</div>
          <div className="value">{status.relayChain.lastBlockNumber.toLocaleString()}</div>
          <div className="subvalue">
            <span className={`connection-dot ${rcStatus.className}`} style={{ marginRight: '4px' }} />
            {rcStatus.text}
            {status.relayChain.syncProgress && (
              <span style={{ marginLeft: '4px' }}>
                ({status.relayChain.syncProgress.percentage.toFixed(1)}%)
              </span>
            )}
          </div>
          <div className="subvalue" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
            {formatTimestamp(status.relayChain.lastBlockTime)}
            {status.relayChain.syncProgress && (
              <span> • {status.relayChain.syncProgress.blocksRemaining} blocks left</span>
            )}
          </div>
        </div>

        <div className="status-card">
          <div className="label">Asset Hub</div>
          <div className="value">{status.assetHub.lastBlockNumber.toLocaleString()}</div>
          <div className="subvalue">
            <span className={`connection-dot ${ahStatus.className}`} style={{ marginRight: '4px' }} />
            {ahStatus.text}
            {status.assetHub.syncProgress && (
              <span style={{ marginLeft: '4px' }}>
                ({status.assetHub.syncProgress.percentage.toFixed(1)}%)
              </span>
            )}
          </div>
          <div className="subvalue" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
            {formatTimestamp(status.assetHub.lastBlockTime)}
            {status.assetHub.syncProgress && (
              <span> • {status.assetHub.syncProgress.blocksRemaining} blocks left</span>
            )}
          </div>
        </div>

        <div className="status-card">
          <div className="label">Chain Height</div>
          <div className="value">{status.relayChain.currentHeight.toLocaleString()}</div>
          <div className="subvalue">RC</div>
          <div className="value" style={{ marginTop: '8px' }}>{status.assetHub.currentHeight.toLocaleString()}</div>
          <div className="subvalue">AH</div>
        </div>
      </div>
    </>
  );
};
