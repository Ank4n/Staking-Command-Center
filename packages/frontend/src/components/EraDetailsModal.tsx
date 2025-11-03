import { useState, useEffect } from 'react';
import { useStatus } from '../hooks/useApi';
import { generateMockEraData, type MockEraDetails } from '../utils/mockEraData';
import type { Era, Session, Warning, BlockchainEvent } from '@staking-cc/shared';

interface EraDetailsModalProps {
  eraId: number | null;
  onClose: () => void;
}

type TabType = 'overview' | 'sessions' | 'events' | 'warnings' | 'elections' | 'rewards' | 'config';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const EraDetailsModal: React.FC<EraDetailsModalProps> = ({ eraId, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [eraData, setEraData] = useState<MockEraDetails | null>(null);
  const { status } = useStatus();

  useEffect(() => {
    if (!eraId) return;

    // Fetch real data from API
    setLoading(true);

    const fetchEraData = async () => {
      try {
        // Fetch era, sessions, warnings, and events in parallel
        const [eraRes, sessionsRes, warningsRes, eventsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/eras/${eraId}`),
          fetch(`${API_BASE_URL}/api/eras/${eraId}/sessions`),
          fetch(`${API_BASE_URL}/api/eras/${eraId}/warnings`),
          fetch(`${API_BASE_URL}/api/events/ah?limit=100`),
        ]);

        if (!eraRes.ok) throw new Error('Failed to fetch era');

        const era: Era = await eraRes.json();
        const sessions: Session[] = sessionsRes.ok ? await sessionsRes.json() : [];
        const warnings: Warning[] = warningsRes.ok ? await warningsRes.json() : [];
        const allEvents: BlockchainEvent[] = eventsRes.ok ? await eventsRes.json() : [];

        // Filter events for this era (based on block numbers from sessions)
        const sessionBlockNumbers = new Set(sessions.map(s => s.blockNumber));
        const eraEvents = allEvents.filter(e => sessionBlockNumbers.has(e.blockNumber));

        // Calculate derived data
        const isActive = era.sessionEnd === null;
        const sessionCount = isActive
          ? (status?.currentSession || 0) - era.sessionStart + 1
          : (era.sessionEnd || era.sessionStart) - era.sessionStart + 1;

        const endTime = isActive ? null : (sessions[sessions.length - 1]?.activationTimestamp || null);
        const durationMs = (isActive ? Date.now() : (endTime || Date.now())) - era.startTime;
        const hours = durationMs / (1000 * 60 * 60);
        const duration = hours < 24
          ? `${hours.toFixed(1)} hrs`
          : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;

        // For now, keep mocking election phases and inflation
        // These will be replaced once election tracking is implemented
        const mockData = generateMockEraData(eraId, status?.currentEra || undefined);

        // Merge real data with mock data
        const mergedData: MockEraDetails = {
          eraId: era.eraId,
          sessionStart: era.sessionStart,
          sessionEnd: era.sessionEnd,
          startTime: era.startTime,
          endTime: endTime,
          sessions: sessions,
          warnings: warnings,
          events: eraEvents,
          isActive: isActive,
          duration: duration,
          sessionCount: sessionCount,
          // Keep mocked for now
          electionStartSessionIndex: mockData.electionStartSessionIndex,
          electionPhases: mockData.electionPhases,
          inflation: mockData.inflation,
          validatorCount: mockData.validatorCount,
        };

        setEraData(mergedData);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch era data:', error);
        // Fallback to mock data on error
        const mockData = generateMockEraData(eraId, status?.currentEra || undefined);
        setEraData(mockData);
        setLoading(false);
      }
    };

    fetchEraData();
  }, [eraId, status?.currentEra, status?.currentSession]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (!eraId) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊', badge: undefined, comingSoon: false },
    { id: 'elections', label: 'Elections', icon: '🗳️', badge: undefined, comingSoon: false },
    { id: 'sessions', label: 'Sessions', icon: '📋', badge: undefined, comingSoon: false },
    { id: 'events', label: 'Events', icon: '⚡', badge: undefined, comingSoon: false },
    { id: 'warnings', label: 'Warnings', icon: '⚠️', badge: eraData?.warnings.length || 0, comingSoon: false },
    { id: 'rewards', label: 'Rewards', icon: '💰', badge: undefined, comingSoon: true },
  ] as const;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-container">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span>Era #{eraId}</span>
            {eraData?.isActive && <span className="badge badge-success">Active</span>}
          </div>
          <button className="modal-close" onClick={onClose} title="Close (ESC)">
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`modal-tab ${activeTab === tab.id ? 'active' : ''} ${tab.comingSoon ? 'coming-soon' : ''}`}
              onClick={() => setActiveTab(tab.id as TabType)}
              title={tab.comingSoon ? 'Coming soon' : ''}
            >
              {tab.icon} {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span style={{
                  marginLeft: '6px',
                  background: '#ef4444',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: '700',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="modal-content">
          {loading ? (
            <div className="loading">
              <div className="loading-spinner" />
              <div>Loading era details...</div>
            </div>
          ) : eraData ? (
            <>
              {activeTab === 'overview' && <OverviewTab eraData={eraData} />}
              {activeTab === 'sessions' && <SessionsTab eraData={eraData} />}
              {activeTab === 'events' && <EventsTab eraData={eraData} />}
              {activeTab === 'warnings' && <WarningsTab eraData={eraData} />}
              {activeTab === 'elections' && <ElectionsTab eraData={eraData} />}
              {activeTab === 'rewards' && <ComingSoonTab icon="💰" title="Rewards & Payouts" description="View inflation amounts, claimed/unclaimed rewards, and reward distribution" />}
            </>
          ) : (
            <div className="error">Failed to load era data</div>
          )}
        </div>
      </div>
    </div>
  );
};

// Overview Tab Component
const OverviewTab: React.FC<{ eraData: MockEraDetails }> = ({ eraData }) => {
  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  // Simplified timeline: Era Start -> Election Started -> Election Ended -> Era Ended
  const electionStartTime = eraData.electionPhases.snapshot.timestamp || null;
  const electionEndTime = eraData.electionPhases.export.timestamp || null;

  const timelineSteps = [
    {
      id: 'era-start',
      icon: '🚀',
      label: 'Era Start',
      timestamp: eraData.startTime,
      status: 'completed' as const,
    },
    {
      id: 'election-started',
      icon: '🗳️',
      label: 'Election Started',
      timestamp: electionStartTime,
      status: eraData.electionPhases.snapshot.started ? 'completed' as const : 'pending' as const,
    },
    {
      id: 'election-ended',
      icon: '✅',
      label: 'Election Ended',
      timestamp: electionEndTime,
      status: eraData.electionPhases.export.completed ? 'completed' as const : 'pending' as const,
    },
    {
      id: 'era-ended',
      icon: '🏁',
      label: 'Era Ended',
      timestamp: eraData.endTime,
      status: eraData.isActive ? 'pending' as const : 'completed' as const,
    },
  ];

  return (
    <div>
      {/* Simplified Timeline: Era Start -> Election Started -> Election Ended -> Era Ended */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '20px',
        padding: '30px 20px',
        background: '#252525',
        borderRadius: '8px',
        marginBottom: '30px',
        overflowX: 'auto',
      }}>
        {timelineSteps.map((step, index) => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '150px',
            }}>
              {/* Icon */}
              <div style={{
                fontSize: '32px',
                marginBottom: '10px',
                opacity: step.status === 'completed' ? 1 : 0.3,
                filter: step.status === 'completed' ? 'none' : 'grayscale(100%)',
                transition: 'all 0.3s ease',
              }}>
                {step.icon}
              </div>
              {/* Label */}
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: step.status === 'completed' ? '#fff' : '#666',
                marginBottom: '8px',
                textAlign: 'center',
              }}>
                {step.label}
              </div>
              {/* Timestamp */}
              <div style={{
                fontSize: '11px',
                color: step.status === 'completed' ? '#667eea' : '#555',
                fontFamily: 'monospace',
                textAlign: 'center',
              }}>
                {step.timestamp ? new Date(step.timestamp).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }) : eraData.isActive && step.id === 'era-ended' ? 'Ongoing...' : 'Waiting...'}
              </div>
            </div>
            {index < timelineSteps.length - 1 && (
              <div style={{
                fontSize: '24px',
                color: step.status === 'completed' ? '#667eea' : '#444',
                transition: 'color 0.3s ease',
              }}>
                →
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info Cards */}
      <div className="info-cards">
        <div className="info-card">
          <div className="info-card-label">Era ID</div>
          <div className="info-card-value">#{eraData.eraId}</div>
        </div>

        <div className="info-card">
          <div className="info-card-label">Status</div>
          <div className="info-card-value">
            {eraData.isActive ? (
              <span className="badge badge-success">Active</span>
            ) : (
              <span className="badge badge-secondary">Ended</span>
            )}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-label">Session Range</div>
          <div className="info-card-value">{eraData.sessionStart}</div>
          <div className="info-card-subvalue">
            → {eraData.sessionEnd || 'Ongoing'}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-label">Sessions</div>
          <div className="info-card-value">
            {eraData.sessionCount}{eraData.isActive && '*'}
          </div>
          {eraData.isActive && (
            <div className="info-card-subvalue">In progress</div>
          )}
        </div>

        <div className="info-card">
          <div className="info-card-label">Duration</div>
          <div className="info-card-value" style={{ fontSize: '18px' }}>
            {eraData.duration}
          </div>
          {eraData.isActive && (
            <div className="info-card-subvalue">Ongoing</div>
          )}
        </div>

        <div className="info-card">
          <div className="info-card-label">Total Validator Points</div>
          <div className="info-card-value" style={{ fontSize: '18px' }}>
            {eraData.sessions.reduce((sum, s) => sum + s.validatorPointsTotal, 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Inflation and Rewards (Completed Eras Only) */}
      {!eraData.isActive && eraData.inflation && (
        <div className="modal-section">
          <div className="modal-section-title">Inflation & Rewards</div>
          <div className="info-cards">
            <div className="info-card">
              <div className="info-card-label">Total Minted</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#f59e0b' }}>
                {eraData.inflation.totalMinted}
              </div>
              <div className="info-card-subvalue">New DOTs created</div>
            </div>

            <div className="info-card">
              <div className="info-card-label">Validator Rewards</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#10b981' }}>
                {eraData.inflation.validatorRewards}
              </div>
              <div className="info-card-subvalue">
                {eraData.inflation.totalMinted && eraData.inflation.validatorRewards
                  ? `${Math.round((parseInt(eraData.inflation.validatorRewards.replace(/[^\d]/g, '')) /
                      parseInt(eraData.inflation.totalMinted.replace(/[^\d]/g, ''))) * 100)}%`
                  : '—'} of total
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-label">Treasury</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#3b82f6' }}>
                {eraData.inflation.treasury}
              </div>
              <div className="info-card-subvalue">
                {eraData.inflation.totalMinted && eraData.inflation.treasury
                  ? `${Math.round((parseInt(eraData.inflation.treasury.replace(/[^\d]/g, '')) /
                      parseInt(eraData.inflation.totalMinted.replace(/[^\d]/g, ''))) * 100)}%`
                  : '—'} of total
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-label">Validators Elected</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#667eea' }}>
                {eraData.validatorCount || '—'}
              </div>
              <div className="info-card-subvalue">For next era</div>
            </div>
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="modal-section">
        <div className="modal-section-title">Timestamps</div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="info-card">
            <div className="info-card-label">Start Time</div>
            <div className="info-card-value" style={{ fontSize: '14px', color: '#aaa' }}>
              {formatTimestamp(eraData.startTime)}
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-label">End Time</div>
            <div className="info-card-value" style={{ fontSize: '14px', color: '#aaa' }}>
              {eraData.isActive ? 'Ongoing' : formatTimestamp(eraData.endTime)}
            </div>
          </div>
        </div>
      </div>

      {/* Session Pills */}
      <div className="modal-section">
        <div className="modal-section-title">Sessions in This Era</div>
        <div className="session-pills">
          {eraData.sessions.map((session, index) => (
            <div
              key={session.sessionId}
              className={`session-pill ${
                index === eraData.sessions.length - 1 && eraData.isActive
                  ? 'active'
                  : 'completed'
              }`}
            >
              Session {session.sessionId}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Sessions Tab Component
const SessionsTab: React.FC<{ eraData: MockEraDetails }> = ({ eraData }) => {
  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  const formatTimeShort = (timestamp: number | null) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ margin: 0, marginBottom: '5px' }}>Sessions Timeline</h3>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {eraData.sessions.length} sessions in this era
        </div>
      </div>

      {/* Vertical Timeline */}
      <div style={{ position: 'relative', paddingLeft: '40px', width: '100%', overflowX: 'hidden' }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute',
          left: '20px',
          top: '20px',
          bottom: '20px',
          width: '3px',
          background: 'linear-gradient(to bottom, #667eea, #444)',
        }} />

        {eraData.sessions.map((session, index) => {
          const isFirst = index === 0;
          const isLast = index === eraData.sessions.length - 1;
          const isElectionActive = session.plannedEraId !== session.activeEraId;

          // Determine what time to show
          let timeLabel = 'Session Activation';
          let timestamp = session.activationTimestamp;

          if (isFirst) {
            timeLabel = 'Era Start Time';
            timestamp = eraData.startTime;
          } else if (isLast && eraData.endTime) {
            timeLabel = 'Era End Time';
            timestamp = eraData.endTime;
          }

          return (
            <div key={session.sessionId} style={{ position: 'relative', marginBottom: '30px' }}>
              {/* Timeline dot */}
              <div style={{
                position: 'absolute',
                left: '-28px',
                top: '20px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: isFirst || isLast ? '#667eea' : '#444',
                border: '3px solid #1a1a1a',
                boxShadow: isFirst || isLast ? '0 0 10px rgba(102, 126, 234, 0.5)' : 'none',
              }} />

              {/* Session Card */}
              <div style={{
                background: '#252525',
                border: `2px solid ${isFirst || isLast ? '#667eea' : '#333'}`,
                borderRadius: '8px',
                padding: '20px',
                transition: 'all 0.3s ease',
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#667eea' }}>
                      Session #{session.sessionId}
                    </span>
                    {isFirst && <span style={{ fontSize: '18px' }} title="Era Start">⭐</span>}
                    {isElectionActive && <span style={{ fontSize: '18px' }} title="Election Active">🗳️</span>}
                    {isLast && !eraData.isActive && <span style={{ fontSize: '18px' }} title="Era End">🏁</span>}
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', textAlign: 'right' }}>
                    <div>{formatTimeShort(timestamp)}</div>
                  </div>
                </div>

                {/* Grid of info */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '15px',
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Block Number
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa', fontFamily: 'monospace' }}>
                      #{session.blockNumber.toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Active Era
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa' }}>
                      Era {session.activeEraId}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Planned Era
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: isElectionActive ? '#f59e0b' : '#aaa' }}>
                      Era {session.plannedEraId}
                      {isElectionActive && <span style={{ marginLeft: '5px', fontSize: '12px' }}>(Election!)</span>}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Validator Points
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#10b981' }}>
                      {session.validatorPointsTotal.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Timestamp at bottom */}
                <div style={{
                  marginTop: '15px',
                  paddingTop: '15px',
                  borderTop: '1px solid #333',
                  fontSize: '12px',
                  color: '#666',
                }}>
                  <strong style={{ color: '#888' }}>{timeLabel}:</strong> {formatTimestamp(timestamp)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Events Tab Component
const EventsTab: React.FC<{ eraData: MockEraDetails }> = ({ eraData }) => {
  const getEventColor = (eventType: string) => {
    if (eventType.includes('SessionReportReceived')) return '#667eea';
    if (eventType.includes('EraPaid')) return '#10b981';
    if (eventType.includes('Election')) return '#f59e0b';
    if (eventType.includes('NewSession')) return '#3b82f6';
    return '#888';
  };

  const getSubscanLink = (eventId: string) => {
    return `https://kusama.subscan.io/event/${eventId}`;
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>Events</h3>
        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>
          Total: {eraData.events.length} events during this era
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Block Number</th>
            <th>Event ID</th>
            <th>Data Preview</th>
          </tr>
        </thead>
        <tbody>
          {eraData.events.map((event) => {
            const eventType = event.eventType.split('.').pop() || event.eventType;
            const data = JSON.parse(event.data);
            const dataPreview = Object.entries(data).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ');

            return (
              <tr key={event.id}>
                <td>
                  <span style={{
                    color: getEventColor(event.eventType),
                    fontWeight: '600',
                    fontFamily: 'monospace',
                  }}>
                    {eventType}
                  </span>
                </td>
                <td>#{event.blockNumber.toLocaleString()}</td>
                <td>
                  <a
                    href={getSubscanLink(event.eventId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#667eea',
                      textDecoration: 'none',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  >
                    {event.eventId}
                  </a>
                </td>
                <td style={{ fontSize: '12px', color: '#888', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dataPreview}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Warnings Tab Component
const WarningsTab: React.FC<{ eraData: MockEraDetails }> = ({ eraData }) => {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getSeverityBadge = (severity: string) => {
    const classes: Record<string, string> = {
      info: 'badge-info',
      warning: 'badge-warning',
      error: 'badge-error',
    };
    return classes[severity] || 'badge-secondary';
  };

  if (eraData.warnings.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">✅</div>
        <div>No warnings for this era</div>
        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
          This era completed without any detected issues
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>Warnings</h3>
        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>
          Total: {eraData.warnings.length} warning{eraData.warnings.length !== 1 ? 's' : ''} detected
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Type</th>
            <th>Message</th>
            <th>Session</th>
            <th>Block</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {eraData.warnings.map((warning) => (
            <tr key={warning.id}>
              <td>
                <span className={`badge ${getSeverityBadge(warning.severity)}`}>
                  {warning.severity}
                </span>
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                {warning.type}
              </td>
              <td>{warning.message}</td>
              <td>#{warning.sessionId}</td>
              <td>#{warning.blockNumber.toLocaleString()}</td>
              <td style={{ fontSize: '12px', color: '#888' }}>
                {formatTimestamp(warning.timestamp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Elections Tab Component
const ElectionsTab: React.FC<{ eraData: MockEraDetails }> = ({ eraData }) => {
  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  // Check if election has started
  const electionStarted = eraData.electionPhases.snapshot.started;

  // Mock config values
  const config = {
    expectedEraTime: '24 hours',
    desiredValidatorCount: 297,
    minimumTrustScore: '0.85',
    validatorTreasurySplit: '60% / 40%',
  };

  // Election stages as per CLAUDE.md
  const stages = [
    {
      id: 1,
      title: 'Election for future era starts',
      description: `Election triggered when current_era became greater than active_era + 1`,
      status: electionStarted ? 'completed' : 'pending',
      timestamp: eraData.electionPhases.snapshot.timestamp,
      details: electionStarted ? [
        { label: 'Block', value: `#${(eraData.sessions[eraData.electionStartSessionIndex]?.blockNumber || 0).toLocaleString()}` },
        { label: 'Session', value: `#${eraData.sessions[eraData.electionStartSessionIndex]?.sessionId || '—'}` },
      ] : [],
    },
    {
      id: 2,
      title: 'Snapshotting',
      description: 'Taking snapshot of validators and nominators',
      status: eraData.electionPhases.snapshot.completed ? 'completed' : eraData.electionPhases.snapshot.started ? 'active' : 'pending',
      timestamp: eraData.electionPhases.snapshot.timestamp,
      details: eraData.electionPhases.snapshot.started ? [
        { label: 'Target Count', value: '297 (mocked)' },
        { label: 'Voter Count', value: '12,458 (mocked)' },
      ] : [],
    },
    {
      id: 3,
      title: 'Signed Phase',
      description: 'Accepting signed solutions from validators',
      status: eraData.electionPhases.signed.completed ? 'completed' : eraData.electionPhases.signed.started ? 'active' : 'pending',
      timestamp: eraData.electionPhases.signed.timestamp,
      details: eraData.electionPhases.signed.started ? [
        { label: 'Max Score', value: '0.92 (mocked)' },
      ] : [],
    },
    {
      id: 4,
      title: 'Signed Validation',
      description: 'Validating submitted signed solutions',
      status: eraData.electionPhases.signed.completed ? 'completed' : eraData.electionPhases.signed.started ? 'active' : 'pending',
      timestamp: eraData.electionPhases.signed.timestamp,
      details: eraData.electionPhases.signed.completed ? [
        { label: 'Accepted Score', value: '0.88 (mocked)' },
      ] : [],
    },
    {
      id: 5,
      title: 'Unsigned Phase',
      description: 'Accepting unsigned fallback solutions',
      status: eraData.electionPhases.unsigned.completed ? 'completed' : eraData.electionPhases.unsigned.started ? 'active' : 'pending',
      timestamp: eraData.electionPhases.unsigned.timestamp,
      details: eraData.electionPhases.unsigned.started ? [
        { label: 'Max Score', value: '0.85 (mocked)' },
      ] : [],
    },
    {
      id: 6,
      title: 'Exporting',
      description: 'Finalizing validator set for next era (may go back to Signed if no solution)',
      status: eraData.electionPhases.export.completed ? 'completed' : eraData.electionPhases.export.started ? 'active' : 'pending',
      timestamp: eraData.electionPhases.export.timestamp,
      details: eraData.electionPhases.export.started ? [
        { label: 'Validator Count', value: `${eraData.validatorCount || 297}` },
        { label: 'Desired Count', value: '297' },
      ] : [],
    },
    {
      id: 7,
      title: 'Off',
      description: 'Election complete, waiting for era transition',
      status: eraData.electionPhases.export.completed ? 'completed' : 'pending',
      timestamp: null,
      details: [],
    },
    {
      id: 8,
      title: 'Validator set sent to RC',
      description: 'Validator set transmitted to Relay Chain',
      status: eraData.electionPhases.export.completed ? 'completed' : 'pending',
      timestamp: null,
      details: [],
    },
    {
      id: 9,
      title: 'Validator queued',
      description: 'Validators queued on Relay Chain for next era',
      status: !eraData.isActive ? 'completed' : 'pending',
      timestamp: null,
      details: [],
    },
    {
      id: 10,
      title: 'Era Ended / Activation timestamp received',
      description: 'New era started, rewards available to claim',
      status: !eraData.isActive ? 'completed' : 'pending',
      timestamp: eraData.endTime,
      details: !eraData.isActive && eraData.inflation ? [
        { label: 'Inflation', value: eraData.inflation.totalMinted },
        { label: 'Validators', value: eraData.inflation.validatorRewards },
        { label: 'Treasury', value: eraData.inflation.treasury },
        { label: 'Era Duration', value: eraData.duration },
      ] : [],
    },
  ];

  const getStatusColor = (status: string) => {
    if (status === 'completed') return '#10b981';
    if (status === 'active') return '#667eea';
    return '#555';
  };

  const getStatusIcon = (status: string) => {
    if (status === 'completed') return '✓';
    if (status === 'active') return '⏳';
    return '○';
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ margin: 0, marginBottom: '10px' }}>Election Timeline for Era {eraData.eraId + 1}</h3>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {electionStarted ? 'Election process for selecting validators' : `Waiting for election to be triggered (expected: ~${new Date(Date.now() + 4 * 60 * 60 * 1000).toLocaleString()})`}
        </div>
      </div>

      {/* Config Values */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '15px',
        marginBottom: '30px',
        padding: '20px',
        background: '#252525',
        borderRadius: '8px',
        width: '100%',
        overflowX: 'hidden',
      }}>
        <div>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
            Expected Era Time
          </div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#aaa' }}>
            {config.expectedEraTime} (mocked)
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
            Desired Validator Count
          </div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#aaa' }}>
            {config.desiredValidatorCount} (mocked)
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
            Minimum Trust Score
          </div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#aaa' }}>
            {config.minimumTrustScore} (mocked)
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
            Validator / Treasury Split
          </div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#aaa' }}>
            {config.validatorTreasurySplit} (mocked)
          </div>
        </div>
      </div>

      {/* Election Stages Flowchart */}
      <div style={{ position: 'relative', paddingLeft: '40px', width: '100%', overflowX: 'hidden' }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute',
          left: '20px',
          top: '20px',
          bottom: '20px',
          width: '3px',
          background: 'linear-gradient(to bottom, #667eea, #444)',
        }} />

        {stages.map((stage) => (
          <div key={stage.id} style={{ position: 'relative', marginBottom: '25px' }}>
            {/* Timeline dot */}
            <div style={{
              position: 'absolute',
              left: '-28px',
              top: '20px',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: getStatusColor(stage.status),
              border: '3px solid #1a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: 'white',
              fontWeight: '700',
            }}>
              {getStatusIcon(stage.status)}
            </div>

            {/* Stage Card */}
            <div style={{
              background: stage.status === 'active' ? '#2a2a3e' : '#252525',
              border: `2px solid ${stage.status === 'active' ? '#667eea' : '#333'}`,
              borderRadius: '8px',
              padding: '20px',
              transition: 'all 0.3s ease',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#888',
                      background: '#1a1a1a',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}>
                      STAGE {stage.id}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: getStatusColor(stage.status),
                      textTransform: 'uppercase',
                    }}>
                      {stage.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff', marginBottom: '5px' }}>
                    {stage.title}
                  </div>
                  <div style={{ fontSize: '13px', color: '#888' }}>
                    {stage.description}
                  </div>
                </div>
              </div>

              {/* Details */}
              {stage.details.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '15px',
                  marginTop: '15px',
                  paddingTop: '15px',
                  borderTop: '1px solid #333',
                }}>
                  {stage.details.map((detail, idx) => (
                    <div key={idx}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
                        {detail.label}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa', fontFamily: 'monospace' }}>
                        {detail.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Timestamp */}
              {stage.timestamp && (
                <div style={{
                  marginTop: '15px',
                  paddingTop: '15px',
                  borderTop: '1px solid #333',
                  fontSize: '12px',
                  color: '#666',
                }}>
                  <strong style={{ color: '#888' }}>Timestamp:</strong> {formatTimestamp(stage.timestamp)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Coming Soon Tab Component
const ComingSoonTab: React.FC<{ icon: string; title: string; description: string }> = ({ icon, title, description }) => {
  return (
    <div className="coming-soon-content">
      <div className="coming-soon-icon">{icon}</div>
      <div className="coming-soon-title">{title} Coming Soon</div>
      <div className="coming-soon-description">{description}</div>
    </div>
  );
};
