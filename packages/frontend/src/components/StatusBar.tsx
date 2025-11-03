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

  const formatPhase = (phase: string | null) => {
    if (!phase) return 'Off';
    return phase.charAt(0).toUpperCase() + phase.slice(1);
  };

  const getPhaseColor = (phase: string | null) => {
    switch (phase) {
      case 'signed':
        return 'badge-info';
      case 'unsigned':
        return 'badge-warning';
      case 'emergency':
        return 'badge-error';
      default:
        return 'badge-secondary';
    }
  };

  return (
    <>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="status-bar">
        <div className="status-card">
          <div className="label">Current Era</div>
          <div className="value">{status.currentEra || '—'}</div>
          <div className="subvalue">Session {status.currentSession || '—'}</div>
        </div>

        <div className="status-card">
          <div className="label">Active Validators</div>
          <div className="value">{status.activeValidators || '—'}</div>
        </div>

        <div className="status-card">
          <div className="label">Election Phase</div>
          <div className="value">
            <span className={`badge ${getPhaseColor(status.electionPhase)}`}>
              {formatPhase(status.electionPhase)}
            </span>
          </div>
        </div>

        <div className="status-card">
          <div className="label">Last Block</div>
          <div className="value">{status.lastBlock.toLocaleString()}</div>
          <div className="subvalue">
            {new Date(status.lastUpdateTime).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </>
  );
};
