import { useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ErasTable } from './components/ErasTable';
import { WarningsPanel } from './components/WarningsPanel';
import { useStatus, useEras, useWarnings } from './hooks/useApi';

function App() {
  const { status, error: statusError, isConnected } = useStatus();
  const { eras, loading: erasLoading, error: erasError } = useEras(20);
  const { warnings, loading: warningsLoading, error: warningsError } = useWarnings(50);
  const [activeTab, setActiveTab] = useState<'eras' | 'warnings'>('eras');

  const chain = status?.chain || 'unknown';
  const chainName = chain.charAt(0).toUpperCase() + chain.slice(1);

  return (
    <div className="container">
      <div className="header">
        <h1>Staking Command Center</h1>
        <div className="subtitle">{chainName} Staking Monitor</div>
      </div>

      {statusError && (
        <div className="error">
          <strong>Error:</strong> {statusError}
        </div>
      )}

      <StatusBar status={status} isConnected={isConnected} />

      <div style={{ marginTop: '30px' }}>
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '20px',
          borderBottom: '1px solid #333'
        }}>
          <button
            onClick={() => setActiveTab('eras')}
            style={{
              padding: '12px 24px',
              background: activeTab === 'eras' ? '#667eea' : 'transparent',
              color: activeTab === 'eras' ? 'white' : '#aaa',
              border: 'none',
              borderBottom: activeTab === 'eras' ? '3px solid #667eea' : '3px solid transparent',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
            }}
          >
            Eras
          </button>
          <button
            onClick={() => setActiveTab('warnings')}
            style={{
              padding: '12px 24px',
              background: activeTab === 'warnings' ? '#667eea' : 'transparent',
              color: activeTab === 'warnings' ? 'white' : '#aaa',
              border: 'none',
              borderBottom: activeTab === 'warnings' ? '3px solid #667eea' : '3px solid transparent',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
              position: 'relative',
            }}
          >
            Warnings
            {warnings.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: '#ef4444',
                color: 'white',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: '700',
              }}>
                {warnings.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'eras' && (
          <div className="section">
            <h2 className="section-title">Recent Eras</h2>
            {erasError && (
              <div className="error">
                <strong>Error:</strong> {erasError}
              </div>
            )}
            <ErasTable eras={eras} loading={erasLoading} />
          </div>
        )}

        {activeTab === 'warnings' && (
          <div className="section">
            <h2 className="section-title">System Warnings</h2>
            {warningsError && (
              <div className="error">
                <strong>Error:</strong> {warningsError}
              </div>
            )}
            <WarningsPanel warnings={warnings} loading={warningsLoading} />
          </div>
        )}
      </div>

      <div style={{
        marginTop: '40px',
        padding: '20px',
        textAlign: 'center',
        color: '#666',
        borderTop: '1px solid #333'
      }}>
        <p>Staking Command Center v0.1.0</p>
        <p style={{ fontSize: '12px', marginTop: '5px' }}>
          Real-time monitoring for {chainName} staking operations
        </p>
      </div>
    </div>
  );
}

export default App;
