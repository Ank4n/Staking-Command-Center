import { useState, useEffect, useCallback } from 'react';
import { useStatus, fetchElectionPhasesByEra, fetchElectionRoundStats } from '../hooks/useApi';
import { generateMockEraData, type EraDetails } from '../utils/mockEraData';
import { formatEventData, formatElectionScore, formatElectionScoreSquared } from '../utils/eventFormatters';
import type { Era, Session, Warning, BlockchainEvent } from '@staking-cc/shared';

interface EraDetailsModalProps {
  eraId: number | null;
  onClose: () => void;
}

type TabType = 'overview' | 'sessions' | 'events' | 'warnings' | 'elections' | 'rewards' | 'config';

// Use empty string to make relative URLs (leverages Vite proxy in dev mode)
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const EraDetailsModal: React.FC<EraDetailsModalProps> = ({ eraId, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [eraData, setEraData] = useState<EraDetails | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { status } = useStatus();

  const fetchEraData = useCallback(async () => {
    if (!eraId) return;

    setLoading(true);
    try {
      // First fetch era to get sessionStart
      const eraRes = await fetch(`${API_BASE_URL}/api/eras/${eraId}`);
        if (!eraRes.ok) throw new Error('Failed to fetch era');
        const era: Era = await eraRes.json();

        // Fetch sessions, warnings, events, election phases, and previous session in parallel
        const [sessionsRes, warningsRes, eventsRes, electionPhases, prevSessionRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/eras/${eraId}/sessions`),
          fetch(`${API_BASE_URL}/api/eras/${eraId}/warnings`),
          fetch(`${API_BASE_URL}/api/eras/${eraId}/events/ah`),
          fetchElectionPhasesByEra(eraId),
          fetch(`${API_BASE_URL}/api/sessions/${era.sessionStart - 1}`),
        ]);

        const sessions: Session[] = sessionsRes.ok ? await sessionsRes.json() : [];
        const warnings: Warning[] = warningsRes.ok ? await warningsRes.json() : [];
        const allEvents: BlockchainEvent[] = eventsRes.ok ? await eventsRes.json() : [];
        const prevSession: Session | null = prevSessionRes.ok ? await prevSessionRes.json() : null;

        // Filter events to show only important event types (from CLAUDE.md Events Tracking section)
        const importantEventPrefixes = [
          'staking.',
          'stakingRcClient.',
          'multiBlockElection.',
          'multiBlockElectionSigned.',
          'multiBlockElectionVerifier.',
          'session.NewQueued',
          'session.NewSession',
        ];

        const isImportantEvent = (eventType: string) => {
          const lowerType = eventType.toLowerCase();
          return importantEventPrefixes.some(prefix => lowerType.startsWith(prefix.toLowerCase()));
        };

        const eraEvents = allEvents.filter(e => isImportantEvent(e.eventType));

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

        // Use mock data for fallback when election phases are not available
        const mockData = generateMockEraData(eraId, status?.currentEra || undefined);

        // Transform election phases from database into UI format
        // If no election phases exist, use mocked data
        const hasElectionData = electionPhases && electionPhases.length > 0;
        let electionStartSessionIndex = mockData.electionStartSessionIndex;
        let electionPhasesData = mockData.electionPhases;

        if (hasElectionData) {
          // Find earliest election phase to determine start session
          const snapshotPhase = electionPhases.find((p: any) => p.phase === 'Snapshot');
          if (snapshotPhase) {
            const snapshotSession = sessions.find(s => s.blockNumber === snapshotPhase.blockNumber);
            if (snapshotSession) {
              electionStartSessionIndex = sessions.indexOf(snapshotSession);
            }
          }

          // Transform phases into UI format
          const phases = ['Snapshot', 'Signed', 'SignedValidation', 'Unsigned', 'Export'].map(phaseName => {
            const phase = electionPhases.find((p: any) => p.phase === phaseName);
            return {
              started: phase ? true : false,
              completed: phase ? true : false,
              timestamp: phase?.timestamp || null,
            };
          });

          electionPhasesData = {
            snapshot: phases[0],
            signed: phases[1],
            unsigned: phases[3],
            export: phases[4],
          };
        }

        // Use real inflation data if available, otherwise fallback to mock
        const hasRealInflation = era.inflationTotal !== null && era.inflationTotal !== undefined;
        const inflation = hasRealInflation ? {
          totalMinted: era.inflationTotal!,
          validatorRewards: era.inflationValidators!,
          treasury: era.inflationTreasury!,
        } : mockData.inflation;

        const validatorCount = era.validatorsElected !== null && era.validatorsElected !== undefined
          ? era.validatorsElected
          : mockData.validatorCount;

        // Merge real data with mock data
        const mergedData: EraDetails = {
          eraId: era.eraId,
          sessionStart: era.sessionStart,
          sessionEnd: era.sessionEnd,
          startTime: era.startTime,
          endTime: endTime,
          sessions: sessions,
          prevSession: prevSession,
          warnings: warnings,
          events: eraEvents,
          isActive: isActive,
          duration: duration,
          sessionCount: sessionCount,
          electionStartSessionIndex: electionStartSessionIndex,
          electionPhases: electionPhasesData,
          electionPhasesRaw: electionPhases, // Store raw election phase data for Elections tab
          inflation: inflation,
          validatorCount: validatorCount,
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
  }, [eraId, status?.currentEra, status?.currentSession]);

  useEffect(() => {
    fetchEraData();
  }, [fetchEraData, refreshTrigger]);

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

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
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
              {activeTab === 'overview' && <OverviewTab eraData={eraData} chain={status?.chain || 'unknown'} />}
              {activeTab === 'sessions' && <SessionsTab eraData={eraData} />}
              {activeTab === 'events' && <EventsTab eraData={eraData} chain={status?.chain || 'unknown'} />}
              {activeTab === 'warnings' && <WarningsTab eraData={eraData} />}
              {activeTab === 'elections' && <ElectionsTab eraData={eraData} chain={status?.chain || 'unknown'} onRefresh={handleRefreshData} />}
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

// Utility to format token amounts
const formatTokenAmount = (planckAmount: string, decimals: number = 12): string => {
  try {
    const bigIntValue = BigInt(planckAmount);
    const divisor = BigInt(10 ** decimals);
    const wholePart = bigIntValue / divisor;
    const fractionalPart = bigIntValue % divisor;

    // Format with commas
    const wholeStr = wholePart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // If there's a fractional part, show up to 2 decimal places
    if (fractionalPart > 0) {
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const roundedFractional = fractionalStr.substring(0, 2);
      return `${wholeStr}.${roundedFractional}`;
    }

    return wholeStr;
  } catch (e) {
    return '—';
  }
};

// Get token name based on chain
const getTokenName = (chain: string): string => {
  switch (chain.toLowerCase()) {
    case 'polkadot': return 'DOT';
    case 'kusama': return 'KSM';
    case 'westend': return 'WND';
    default: return 'TOKENS';
  }
};

// Get Subscan base URL for Asset Hub based on chain
const getAssetHubSubscanUrl = (chain: string): string => {
  switch (chain.toLowerCase()) {
    case 'polkadot': return 'https://assethub-polkadot.subscan.io';
    case 'kusama': return 'https://assethub-kusama.subscan.io';
    case 'westend': return 'https://assethub-westend.subscan.io';
    default: return 'https://subscan.io';
  }
};

// Overview Tab Component
const OverviewTab: React.FC<{ eraData: EraDetails; chain: string }> = ({ eraData, chain }) => {
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
      </div>

      {/* Inflation and Rewards (Completed Eras Only) */}
      {!eraData.isActive && eraData.inflation && (
        <div className="modal-section">
          <div className="modal-section-title">Inflation & Rewards</div>
          <div className="info-cards">
            <div className="info-card">
              <div className="info-card-label">Total Minted</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#f59e0b' }}>
                {formatTokenAmount(eraData.inflation.totalMinted)} {getTokenName(chain)}
              </div>
              <div className="info-card-subvalue">Validator + Treasury</div>
            </div>

            <div className="info-card">
              <div className="info-card-label">Validator Rewards</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#10b981' }}>
                {formatTokenAmount(eraData.inflation.validatorRewards)} {getTokenName(chain)}
              </div>
              <div className="info-card-subvalue">
                {(() => {
                  try {
                    const total = BigInt(eraData.inflation.totalMinted);
                    const validators = BigInt(eraData.inflation.validatorRewards);
                    const percentage = Number((validators * BigInt(10000)) / total) / 100;
                    return `${percentage.toFixed(1)}% of total`;
                  } catch (e) {
                    return '—';
                  }
                })()}
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-label">Treasury</div>
              <div className="info-card-value" style={{ fontSize: '18px', color: '#3b82f6' }}>
                {formatTokenAmount(eraData.inflation.treasury)} {getTokenName(chain)}
              </div>
              <div className="info-card-subvalue">
                {(() => {
                  try {
                    const total = BigInt(eraData.inflation.totalMinted);
                    const treasury = BigInt(eraData.inflation.treasury);
                    const percentage = Number((treasury * BigInt(10000)) / total) / 100;
                    return `${percentage.toFixed(1)}% of total`;
                  } catch (e) {
                    return '—';
                  }
                })()}
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
const SessionsTab: React.FC<{ eraData: EraDetails }> = ({ eraData }) => {
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
                      Start Block
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa', fontFamily: 'monospace' }}>
                      {(() => {
                        // For first session of era, use prevSession from previous era
                        if (index === 0 && eraData.prevSession?.blockNumber) {
                          return `#${(eraData.prevSession.blockNumber + 1).toLocaleString()}`;
                        }
                        // For other sessions, use previous session in current era
                        // Sessions are ordered ASC by session_id, so index-1 is the previous session
                        const prevSession = eraData.sessions[index - 1];
                        if (prevSession?.blockNumber) {
                          return `#${(prevSession.blockNumber + 1).toLocaleString()}`;
                        }
                        // If no previous session available, can't determine start block
                        return '-';
                      })()}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      End Block
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa', fontFamily: 'monospace' }}>
                      {session.blockNumber ? `#${session.blockNumber.toLocaleString()}` : '-'}
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
                      Validator Count
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
const EventsTab: React.FC<{ eraData: EraDetails; chain: string }> = ({ eraData, chain }) => {
  const getEventColor = (eventType: string) => {
    if (eventType.includes('SessionReportReceived')) return '#667eea';
    if (eventType.includes('EraPaid')) return '#10b981';
    if (eventType.includes('Election')) return '#f59e0b';
    if (eventType.includes('NewSession')) return '#3b82f6';
    return '#888';
  };

  const getSubscanLink = (eventId: string) => {
    // All events in era details are from Asset Hub (AH)
    return `${getAssetHubSubscanUrl(chain)}/event/${eventId}`;
  };

  // Sort events by block number (oldest first)
  const sortedEvents = [...eraData.events].sort((a, b) => a.blockNumber - b.blockNumber);

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
          {sortedEvents.map((event) => {
            const eventType = event.eventType.split('.').pop() || event.eventType;
            const dataPreview = formatEventData(event.eventType, event.data);

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
                <td style={{ fontSize: '12px', color: '#888', minWidth: '300px', maxWidth: '600px' }}>
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
const WarningsTab: React.FC<{ eraData: EraDetails }> = ({ eraData }) => {
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
const ElectionsTab: React.FC<{ eraData: EraDetails; chain: string; onRefresh: () => void }> = ({ eraData, chain, onRefresh }) => {
  const [roundStats, setRoundStats] = useState<any>(null);
  const [loadingRoundStats, setLoadingRoundStats] = useState(false);
  const [refreshingPhases, setRefreshingPhases] = useState(false);
  const { status } = useStatus();

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  const formatCount = (value: number | null) => {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString();
  };

  // Removed formatBigNumber - now using formatElectionScore from utils

  const shortenAddress = (address: string): string => {
    if (address.length < 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  // Check if we have real election data
  const hasRealElectionData = eraData.electionPhasesRaw && eraData.electionPhasesRaw.length > 0;

  // Check if election has started
  const electionStarted = eraData.electionPhases.snapshot.started;

  // Fetch round stats if we have election data
  useEffect(() => {
    if (!hasRealElectionData) return;

    const fetchRoundStats = async () => {
      try {
        // Find the round number from election phases
        const snapshotPhase = eraData.electionPhasesRaw?.find((p: any) => p.phase === 'Snapshot');
        if (!snapshotPhase || snapshotPhase.round === null || snapshotPhase.round === undefined) return;

        setLoadingRoundStats(true);
        const stats = await fetchElectionRoundStats(snapshotPhase.round);
        setRoundStats(stats);
      } catch (error) {
        console.error('Failed to fetch round stats:', error);
      } finally {
        setLoadingRoundStats(false);
      }
    };

    fetchRoundStats();
  }, [hasRealElectionData, eraData.electionPhasesRaw]);

  // Helper to calculate block progress
  const calculateBlockProgress = (phase: any) => {
    if (!phase.expectedDurationBlocks || !status?.assetHub?.currentHeight) {
      return null;
    }

    const currentBlock = status.assetHub.currentHeight;
    const phaseStartBlock = phase.blockNumber;
    const expectedEndBlock = phaseStartBlock + phase.expectedDurationBlocks;
    const blocksElapsed = currentBlock - phaseStartBlock;
    const blocksRemaining = expectedEndBlock - currentBlock;

    return {
      expectedDurationBlocks: phase.expectedDurationBlocks,
      blocksElapsed,
      blocksRemaining,
      isDelayed: blocksRemaining < 0,
      expectedEndBlock,
    };
  };

  // Helper to determine phase status
  const getPhaseStatus = (phase: any, nextPhaseExists: boolean) => {
    // If there's a next phase, this phase is completed
    if (nextPhaseExists) {
      return 'completed';
    }

    // If status field exists in DB, use it
    if (phase.status) {
      if (phase.status === 'completed') return 'completed';
      if (phase.status === 'ongoing') {
        const progress = calculateBlockProgress(phase);
        return progress?.isDelayed ? 'delayed' : 'active';
      }
    }

    // Fallback: assume last phase is active
    return 'active';
  };

  // Build stages from real data if available, otherwise use mock structure
  const stages = hasRealElectionData
    ? eraData.electionPhasesRaw!.map((phase: any, index: number, array: any[]) => {
        const getIcon = (phaseName: string) => {
          switch (phaseName) {
            case 'Off': return '⭕';
            case 'Snapshot': return '📸';
            case 'Signed': return '✍️';
            case 'SignedValidation': return '✔️';
            case 'Unsigned': return '📝';
            case 'Done': return '✅';
            case 'Export': return '📤';
            default: return '📋';
          }
        };

        const nextPhaseExists = index < array.length - 1;
        const phaseStatus = getPhaseStatus(phase, nextPhaseExists);
        const blockProgress = calculateBlockProgress(phase);

        const details: Array<{ label: string; value: string | JSX.Element }> = [];

        // Add phase-specific details
        if (phase.phase === 'Snapshot') {
          if (phase.validatorCandidates !== null && phase.validatorCandidates !== undefined) {
            details.push({ label: 'Validator Count', value: formatCount(phase.validatorCandidates) });
          }
          if (phase.nominatorCandidates !== null && phase.nominatorCandidates !== undefined) {
            details.push({ label: 'Nominator Count', value: formatCount(phase.nominatorCandidates) });
          }
          // Min Nominator Bond is not yet implemented
          details.push({ label: 'Min Nominator Bond', value: '— (not tracked)' });
        }

        // Add submission count for Signed phase
        if (phase.phase === 'Signed' && roundStats) {
          details.push({ label: 'Submissions', value: formatCount(roundStats.submissionCount) });
        }

        // Add winner info for SignedValidation phase
        if (phase.phase === 'SignedValidation' && roundStats) {
          if (roundStats.winner) {
            details.push({
              label: 'Winner',
              value: `${shortenAddress(roundStats.winner.submitter)} ⭐`
            });
            details.push({
              label: 'Minimal Stake',
              value: formatElectionScore(roundStats.winner.minimalStake)
            });
            details.push({
              label: 'Sum Stake',
              value: formatElectionScore(roundStats.winner.sumStake)
            });
            details.push({
              label: 'Sum² Stake',
              value: formatElectionScoreSquared(roundStats.winner.sumStakeSquared)
            });
          } else if (!loadingRoundStats && roundStats.submissionCount > 0) {
            // Only show "No winner" if phase is completed, otherwise show "Waiting for winner"
            const isPhaseCompleted = phaseStatus === 'completed';
            details.push({
              label: 'Winner',
              value: isPhaseCompleted ? 'No winner (all submissions rejected)' : 'Waiting for winner...'
            });
          }
        }

        // Add block progress for phases with duration tracking (Signed, SignedValidation, Unsigned)
        if (blockProgress && (phase.phase === 'Signed' || phase.phase === 'SignedValidation' || phase.phase === 'Unsigned')) {
          details.push({
            label: 'Expected Duration',
            value: `${blockProgress.expectedDurationBlocks} blocks`
          });

          if (phaseStatus === 'active' || phaseStatus === 'delayed') {
            const progressText = blockProgress.isDelayed
              ? `⚠️ Delayed by ${Math.abs(blockProgress.blocksRemaining)} blocks`
              : `${blockProgress.blocksRemaining} blocks remaining`;

            details.push({
              label: 'Progress',
              value: progressText
            });
          }
        }

        return {
          id: index + 1,
          title: phase.phase,
          icon: getIcon(phase.phase),
          status: phaseStatus,
          timestamp: phase.timestamp,
          eventId: phase.eventId,
          details,
          blockProgress,
        };
      })
    : [
        {
          id: 1,
          title: 'Snapshot',
          icon: '📸',
          status: eraData.electionPhases.snapshot.completed ? 'completed' : eraData.electionPhases.snapshot.started ? 'active' : 'pending',
          timestamp: eraData.electionPhases.snapshot.timestamp,
          eventId: null,
          details: eraData.electionPhases.snapshot.started ? [
            { label: 'Validator Count', value: '— (no data)' },
            { label: 'Nominator Count', value: '— (no data)' },
            { label: 'Min Nominator Bond', value: '— (no data)' },
          ] : [],
        },
        {
          id: 2,
          title: 'Signed',
          icon: '✍️',
          status: eraData.electionPhases.signed.completed ? 'completed' : eraData.electionPhases.signed.started ? 'active' : 'pending',
          timestamp: eraData.electionPhases.signed.timestamp,
          eventId: null,
          details: [],
        },
        {
          id: 3,
          title: 'Signed Validation',
          icon: '✔️',
          status: eraData.electionPhases.signed.completed ? 'completed' : eraData.electionPhases.signed.started ? 'active' : 'pending',
          timestamp: eraData.electionPhases.signed.timestamp,
          eventId: null,
          details: [],
        },
        {
          id: 4,
          title: 'Unsigned',
          icon: '📝',
          status: eraData.electionPhases.unsigned.completed ? 'completed' : eraData.electionPhases.unsigned.started ? 'active' : 'pending',
          timestamp: eraData.electionPhases.unsigned.timestamp,
          eventId: null,
          details: [],
        },
      ];

  const getStatusColor = (status: string) => {
    if (status === 'completed') return '#10b981';
    if (status === 'active') return '#667eea';
    if (status === 'delayed') return '#f59e0b';
    return '#555';
  };

  const handleRefreshPhases = async () => {
    setRefreshingPhases(true);
    try {
      // Call parent's refresh function to reload phase data
      await onRefresh();
    } catch (error) {
      console.error('Failed to refresh phases:', error);
    } finally {
      setRefreshingPhases(false);
    }
  };

  const getSubscanEventLink = (eventId: string) => {
    return `${getAssetHubSubscanUrl(chain)}/event/${eventId}`;
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ margin: 0, marginBottom: '10px' }}>Election Phases</h3>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {hasRealElectionData
            ? `Multi-block election for Era ${eraData.eraId + 1}`
            : electionStarted
              ? `Multi-block election for Era ${eraData.eraId + 1} (no data available yet)`
              : `Waiting for election to start`}
        </div>
      </div>

      {/* Election Timeline */}
      <div style={{ position: 'relative', paddingLeft: '50px', width: '100%', overflowX: 'hidden' }}>
        {/* Vertical timeline line */}
        <div style={{
          position: 'absolute',
          left: '25px',
          top: '30px',
          bottom: '30px',
          width: '4px',
          background: 'linear-gradient(to bottom, #667eea 0%, #10b981 100%)',
          borderRadius: '2px',
        }} />

        {stages.map((stage) => (
          <div key={stage.id} style={{ position: 'relative', marginBottom: '30px' }}>
            {/* Timeline dot/icon */}
            <div style={{
              position: 'absolute',
              left: '-38px',
              top: '25px',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: stage.status === 'completed' ? '#10b981' :
                          stage.status === 'active' ? '#667eea' :
                          stage.status === 'delayed' ? '#f59e0b' : '#333',
              border: '4px solid #1a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              zIndex: 2,
              boxShadow: stage.status === 'active' ? '0 0 15px rgba(102, 126, 234, 0.6)' :
                         stage.status === 'delayed' ? '0 0 15px rgba(245, 158, 11, 0.6)' : 'none',
              animation: (stage.status === 'active' || stage.status === 'delayed') ? 'pulse 2s ease-in-out infinite' : 'none',
            }}>
              {stage.icon}
            </div>

            {/* Stage Card */}
            <div style={{
              background: (stage.status === 'active' || stage.status === 'delayed') ? '#2a2a3e' : '#252525',
              border: `2px solid ${stage.status === 'active' ? '#667eea' :
                                    stage.status === 'delayed' ? '#f59e0b' :
                                    stage.status === 'completed' ? '#10b981' : '#333'}`,
              borderRadius: '8px',
              padding: '20px',
              transition: 'all 0.3s ease',
              opacity: stage.status === 'pending' ? 0.5 : 1,
              boxShadow: stage.status === 'active' ? '0 4px 20px rgba(102, 126, 234, 0.2)' :
                         stage.status === 'delayed' ? '0 4px 20px rgba(245, 158, 11, 0.3)' : 'none',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: '#fff' }}>
                      {stage.title}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: '700',
                      color: getStatusColor(stage.status),
                      textTransform: 'uppercase',
                      background: '#1a1a1a',
                      padding: '3px 8px',
                      borderRadius: '4px',
                    }}>
                      {stage.status}
                    </span>
                  </div>

                  {/* Timestamp and Link */}
                  {stage.timestamp && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#888' }}>
                      <span>{formatTimestamp(stage.timestamp)}</span>
                      {stage.eventId && (
                        <>
                          <span style={{ color: '#555' }}>•</span>
                          <a
                            href={getSubscanEventLink(stage.eventId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#667eea',
                              textDecoration: 'none',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                            }}
                          >
                            View on Subscan ↗
                          </a>
                        </>
                      )}
                    </div>
                  )}
                  {!stage.timestamp && (
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Waiting...
                    </div>
                  )}
                </div>

                {/* Refresh button for ongoing phases */}
                {(stage.status === 'active' || stage.status === 'delayed') && (
                  <button
                    onClick={handleRefreshPhases}
                    disabled={refreshingPhases}
                    style={{
                      background: '#333',
                      border: '1px solid #555',
                      borderRadius: '6px',
                      color: '#aaa',
                      padding: '8px 12px',
                      fontSize: '12px',
                      cursor: refreshingPhases ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (!refreshingPhases) {
                        e.currentTarget.style.background = '#3a3a3a';
                        e.currentTarget.style.borderColor = '#667eea';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#333';
                      e.currentTarget.style.borderColor = '#555';
                    }}
                  >
                    <span style={{ fontSize: '14px' }}>🔄</span>
                    <span>Refresh</span>
                  </button>
                )}
              </div>

              {/* Details */}
              {stage.details.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '15px',
                  paddingTop: '15px',
                  borderTop: '1px solid #333',
                }}>
                  {stage.details.map((detail, idx) => (
                    <div key={idx}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>
                        {detail.label}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#aaa' }}>
                        {detail.value}
                      </div>
                    </div>
                  ))}
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
