import { useState, useEffect, useRef } from 'react';
import type { Era } from '@staking-cc/shared';

interface ErasTableProps {
  eras: Era[];
  loading: boolean;
}

export const ErasTable: React.FC<ErasTableProps> = ({ eras, loading }) => {
  const [newEraIds, setNewEraIds] = useState<Set<number>>(new Set());
  const previousErasRef = useRef<Set<number>>(new Set());

  // Detect new eras and mark them for animation
  useEffect(() => {
    const currentEraIds = new Set(eras.map(e => e.eraId));
    const newEras = new Set<number>();

    currentEraIds.forEach(eraId => {
      if (!previousErasRef.current.has(eraId)) {
        newEras.add(eraId);
      }
    });

    if (newEras.size > 0) {
      setNewEraIds(newEras);
      // Remove animation class after 3 seconds (animation duration)
      setTimeout(() => setNewEraIds(new Set()), 3000);
    }

    previousErasRef.current = currentEraIds;
  }, [eras]);
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
          <tr
            key={era.eraId}
            className={newEraIds.has(era.eraId) ? 'new-row' : ''}
          >
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
