import type { ApiStatus } from '@staking-cc/shared';

interface StatusBarProps {
  status: ApiStatus | null;
  isConnected: boolean;
}

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

  return (
    <>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
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
          <div className="label">Relay Chain Block</div>
          <div className="value">{status.lastBlockRC.toLocaleString()}</div>
          <div className="subvalue">
            <span className={`connection-dot ${status.isConnectedRC ? 'connected' : 'disconnected'}`} style={{ marginRight: '4px' }} />
            {status.isConnectedRC ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="status-card">
          <div className="label">Asset Hub Block</div>
          <div className="value">{status.lastBlockAH.toLocaleString()}</div>
          <div className="subvalue">
            <span className={`connection-dot ${status.isConnectedAH ? 'connected' : 'disconnected'}`} style={{ marginRight: '4px' }} />
            {status.isConnectedAH ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="status-card">
          <div className="label">Last Update</div>
          <div className="value">
            {new Date(status.lastUpdateTime).toLocaleTimeString()}
          </div>
          <div className="subvalue">
            {new Date(status.lastUpdateTime).toLocaleDateString()}
          </div>
        </div>
      </div>
    </>
  );
};
