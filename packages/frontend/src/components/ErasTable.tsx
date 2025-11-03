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

  const formatDuration = (startTime: number | null, endTime: number | null) => {
    if (!startTime || !endTime) return '—';
    const duration = endTime - startTime;
    const hours = Math.floor(duration / 3600000);
    return `${hours}h`;
  };

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString();
  };

  const formatAmount = (amount: string | null) => {
    if (!amount) return '—';
    try {
      const value = BigInt(amount);
      const inDOT = Number(value) / 1e10; // Convert from planck to DOT
      return inDOT.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' DOT';
    } catch {
      return '—';
    }
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Era</th>
          <th>Start Session</th>
          <th>End Session</th>
          <th>Start Time</th>
          <th>Duration</th>
          <th>Validators</th>
          <th>Nominators</th>
          <th>Inflation</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {eras.map((era) => (
          <tr key={era.eraIndex}>
            <td>
              <strong>#{era.eraIndex}</strong>
            </td>
            <td>{era.startSession || '—'}</td>
            <td>{era.endSession || '—'}</td>
            <td>{formatTimestamp(era.startTime)}</td>
            <td>{formatDuration(era.startTime, era.endTime)}</td>
            <td>{era.totalValidators?.toLocaleString() || '—'}</td>
            <td>{era.totalNominators?.toLocaleString() || '—'}</td>
            <td>{formatAmount(era.inflationAmount)}</td>
            <td>
              {era.endTime ? (
                <span className="badge badge-secondary">Ended</span>
              ) : (
                <span className="badge badge-success">Active</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
