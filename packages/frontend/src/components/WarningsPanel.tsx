import type { Warning } from '@staking-cc/shared';

interface WarningsPanelProps {
  warnings: Warning[];
  loading: boolean;
}

export const WarningsPanel: React.FC<WarningsPanelProps> = ({ warnings, loading }) => {
  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div>Loading warnings...</div>
      </div>
    );
  }

  if (warnings.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">✓</div>
        <div>No warnings - everything looks good!</div>
      </div>
    );
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'error':
        return 'badge-error';
      case 'warning':
        return 'badge-warning';
      case 'info':
        return 'badge-info';
      default:
        return 'badge-secondary';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'timing':
        return '⏱️';
      case 'missing_event':
        return '❓';
      case 'unexpected_event':
        return '⚠️';
      case 'election_issue':
        return '🗳️';
      default:
        return '📌';
    }
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Era</th>
          <th>Session</th>
          <th>Block</th>
          <th>Message</th>
          <th>Severity</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {warnings.map((warning) => (
          <tr key={warning.id}>
            <td>
              <span title={warning.type}>
                {getTypeIcon(warning.type)} {warning.type.replace('_', ' ')}
              </span>
            </td>
            <td>{warning.eraIndex !== null ? `#${warning.eraIndex}` : '—'}</td>
            <td>{warning.sessionIndex !== null ? warning.sessionIndex : '—'}</td>
            <td>{warning.blockNumber.toLocaleString()}</td>
            <td>{warning.message}</td>
            <td>
              <span className={`badge ${getSeverityBadge(warning.severity)}`}>
                {warning.severity}
              </span>
            </td>
            <td>{new Date(warning.timestamp).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
