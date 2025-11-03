import type { Era } from '@staking-cc/shared';

interface ErasTableProps {
  eras: Era[];
  loading: boolean;
}

export const ErasTable: React.FC<ErasTableProps> = ({ eras, loading }) => {
  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div>Loading eras...</div>
      </div>
    );
  }

  if (eras.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📊</div>
        <div>No era data available yet</div>
      </div>
    );
  }

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Era</th>
          <th>Start Session</th>
          <th>End Session</th>
          <th>Start Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {eras.map((era) => (
          <tr key={era.eraId}>
            <td>
              <strong>#{era.eraId}</strong>
            </td>
            <td>{era.sessionStart || '—'}</td>
            <td>{era.sessionEnd || '—'}</td>
            <td>{formatTimestamp(era.startTime)}</td>
            <td>
              {era.sessionEnd === null ? (
                <span className="badge badge-success">Active</span>
              ) : (
                <span className="badge badge-secondary">Ended</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
