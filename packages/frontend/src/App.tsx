import { useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ErasTable } from './components/ErasTable';
import { WarningsPanel } from './components/WarningsPanel';
import { BlocksTab } from './components/BlocksTab';
import { EventsTab } from './components/EventsTab';
import { SessionsTab } from './components/SessionsTab';
import { ElectionsTab } from './components/ElectionsTab';
import { AdvancedTab } from './components/AdvancedTab';
import { useStatus, useWarnings } from './hooks/useApi';

type TabType = 'eras' | 'warnings' | 'sessions' | 'elections' | 'blocks' | 'events' | 'advanced';

function App() {
  const { status, error: statusError, isConnected } = useStatus();
  const { warnings, loading: warningsLoading, error: warningsError } = useWarnings(50);
  const [activeTab, setActiveTab] = useState<TabType>('eras');
  const [isExpanded, setIsExpanded] = useState(false);

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
          borderBottom: '1px solid #333',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {/* Primary tabs - always visible */}
          {(['eras', 'warnings'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                background: activeTab === tab ? '#667eea' : 'transparent',
                color: activeTab === tab ? 'white' : '#aaa',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #667eea' : '3px solid transparent',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                transition: 'all 0.3s ease',
                position: 'relative',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'warnings' && warnings.length > 0 && (
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
          ))}

          {/* Expand/Collapse button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '12px 20px',
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #444',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {isExpanded ? '▲' : '▼'} More
          </button>

          {/* Secondary tabs - only visible when expanded */}
          {isExpanded && (['sessions', 'elections', 'blocks', 'events', 'advanced'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                background: activeTab === tab ? '#667eea' : 'transparent',
                color: activeTab === tab ? 'white' : '#aaa',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #667eea' : '3px solid transparent',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                transition: 'all 0.3s ease',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'blocks' && (
          <div className="section">
            <h2 className="section-title">Blocks</h2>
            <BlocksTab />
          </div>
        )}

        {activeTab === 'events' && (
          <div className="section">
            <h2 className="section-title">Events</h2>
            <EventsTab />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="section">
            <h2 className="section-title">Sessions</h2>
            <SessionsTab />
          </div>
        )}

        {activeTab === 'eras' && (
          <div className="section">
            <h2 className="section-title">Recent Eras</h2>
            <ErasTable />
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

        {activeTab === 'elections' && (
          <div className="section">
            <h2 className="section-title">Election Scores</h2>
            <ElectionsTab />
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="section">
            <h2 className="section-title">Advanced: Database Viewer</h2>
            <AdvancedTab />
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
