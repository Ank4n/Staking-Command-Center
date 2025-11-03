import { useEffect, useRef, useState } from 'react';
import { useSessions, useStatus } from '../hooks/useApi';

export const SessionsTab: React.FC = () => {
  const { sessions, loading, refetch } = useSessions(100);
  const { status } = useStatus();
  const [newSessionIds, setNewSessionIds] = useState<Set<number>>(new Set());
  const previousSessionsRef = useRef<Set<number>>(new Set());
  const previousAHBlockRef = useRef<number>(0);

  // Auto-refresh when new Asset Hub blocks arrive (sessions are on AH)
  useEffect(() => {
    if (!status) return;

    const currentBlock = status.assetHub.lastBlockNumber;

    // Trigger refetch when a new block arrives
    if (currentBlock !== previousAHBlockRef.current && previousAHBlockRef.current !== 0) {
      refetch();
    }

    previousAHBlockRef.current = currentBlock;
  }, [status, refetch]);

  // Fallback: also refresh every 6 seconds in case WebSocket misses updates
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 6000);

    return () => clearInterval(interval);
  }, [refetch]);

  // Detect new sessions and mark them for animation
  useEffect(() => {
    const currentSessionIds = new Set(sessions.map(s => s.sessionId));
    const newSessions = new Set<number>();

    currentSessionIds.forEach(sessionId => {
      if (!previousSessionsRef.current.has(sessionId)) {
        newSessions.add(sessionId);
      }
    });

    if (newSessions.size > 0) {
      setNewSessionIds(newSessions);
      // Remove animation class after 3 seconds (animation duration)
      setTimeout(() => setNewSessionIds(new Set()), 3000);
    }

    previousSessionsRef.current = currentSessionIds;
  }, [sessions]);

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div>Loading sessions...</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div>No session data available yet</div>
        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
          Sessions are created when SessionReportReceived events are detected on Asset Hub
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>Sessions</h3>
        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>
          Total: {sessions.length} sessions
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Block Number</th>
            <th>Active Era ID</th>
            <th>Planned Era ID</th>
            <th>Activation Time</th>
            <th>Validator Points Total</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, index) => {
            // Check if election is active (plannedEraId > activeEraId)
            const isElectionActive =
              session.plannedEraId !== null &&
              session.activeEraId !== null &&
              session.plannedEraId > session.activeEraId;

            // Check if era just started (activeEraId incremented from previous session)
            // Sessions are ordered DESC, so we compare with next session (lower session ID)
            const previousSession = index < sessions.length - 1 ? sessions[index + 1] : null;
            const isEraStart =
              previousSession &&
              session.activeEraId !== null &&
              previousSession.activeEraId !== null &&
              session.activeEraId > previousSession.activeEraId;

            return (
              <tr
                key={session.sessionId}
                className={newSessionIds.has(session.sessionId) ? 'new-row' : ''}
              >
                <td>
                  <strong>#{session.sessionId}</strong>
                </td>
                <td>#{session.blockNumber.toLocaleString()}</td>
                <td>
                  {session.activeEraId !== null ? (
                    <>
                      {isEraStart && '⭐ '}
                      {session.activeEraId}
                    </>
                  ) : '—'}
                </td>
                <td>
                  {session.plannedEraId !== null ? (
                    <>
                      {isElectionActive && '🗳️ '}
                      {session.plannedEraId}
                    </>
                  ) : '—'}
                </td>
                <td>{formatTimestamp(session.activationTimestamp)}</td>
                <td>{session.validatorPointsTotal.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
