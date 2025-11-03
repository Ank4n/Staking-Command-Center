import { useSessions } from '../hooks/useApi';

export const SessionsTab: React.FC = () => {
  const { sessions, loading, refetch } = useSessions(100);

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
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0 }}>Sessions</h3>
          <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>
            Total: {sessions.length} sessions
          </div>
        </div>
        <button className="btn btn-secondary" onClick={refetch}>
          Refresh
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Block Number</th>
            <th>Era ID</th>
            <th>Activation Time</th>
            <th>Validator Points Total</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.sessionId}>
              <td>
                <strong>#{session.sessionId}</strong>
              </td>
              <td>#{session.blockNumber.toLocaleString()}</td>
              <td>
                {session.eraId !== null ? `Era #${session.eraId}` : '—'}
              </td>
              <td>{formatTimestamp(session.activationTimestamp)}</td>
              <td>{session.validatorPointsTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
