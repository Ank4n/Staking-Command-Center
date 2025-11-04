import { useState, useEffect, useRef } from 'react';
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

const LiveTimer: React.FC<{ timestamp: number; blockNumber: number; prefix?: string }> = ({ timestamp, blockNumber, prefix = '' }) => {
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [startTime, setStartTime] = useState(Date.now());
  const previousBlockRef = useRef(blockNumber);

  // Reset timer to 0 when block number changes
  useEffect(() => {
    if (blockNumber !== previousBlockRef.current) {
      setStartTime(Date.now());
      setSecondsAgo(0);
      previousBlockRef.current = blockNumber;
    }
  }, [blockNumber]);

  useEffect(() => {
    const updateTimer = () => {
      if (timestamp === 0) {
        setSecondsAgo(0);
        return;
      }
      // Count seconds since this block became the latest
      const diff = Math.floor((Date.now() - startTime) / 1000);
      setSecondsAgo(diff);
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [timestamp, startTime]);

  if (timestamp === 0) return <span>Never</span>;

  if (secondsAgo < 60) {
    return <span className="live-timer">{prefix}{secondsAgo}s ago</span>;
  }

  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) {
    return <span>{prefix}{minutes}m {secondsAgo % 60}s ago</span>;
  }

  const hours = Math.floor(minutes / 60);
  return <span>{prefix}{hours}h {minutes % 60}m ago</span>;
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
          <div className="label">Active Era</div>
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
            <LiveTimer timestamp={status.relayChain.lastBlockTime} blockNumber={status.relayChain.lastBlockNumber} />
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
            <LiveTimer timestamp={status.assetHub.lastBlockTime} blockNumber={status.assetHub.lastBlockNumber} />
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
