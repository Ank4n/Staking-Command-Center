import { useState, useEffect, useRef } from 'react';
import type { Era } from '@staking-cc/shared';
import { useStatus, useEras } from '../hooks/useApi';
import { EraDetailsModal } from './EraDetailsModal';

export const ErasTable: React.FC = () => {
  const { eras, loading, refetch } = useEras(20);
  const { status } = useStatus();
  const [newEraIds, setNewEraIds] = useState<Set<number>>(new Set());
  const [selectedEraId, setSelectedEraId] = useState<number | null>(null);
  const previousErasRef = useRef<Set<number>>(new Set());
  const previousAHBlockRef = useRef<number>(0);

  // Auto-refresh when new Asset Hub blocks arrive (eras are created on AH)
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

  const getSessionsCount = (era: Era): string => {
    if (era.sessionEnd === null) {
      // Active era - calculate from current session
      if (!status?.currentSession) return '—';
      const count = status.currentSession - era.sessionStart + 1;
      return `${count}*`; // Asterisk indicates active/growing
    } else {
      // Ended era - calculate from sessionEnd
      return `${era.sessionEnd - era.sessionStart + 1}`;
    }
  };

  const formatDuration = (era: Era): string => {
    const startTime = era.startTime;
    const endTime = era.endTime || Date.now(); // Use current time for active eras

    if (!startTime) return '—';

    const durationMs = endTime - startTime;
    const hours = durationMs / (1000 * 60 * 60);

    if (hours < 24) {
      return `${hours.toFixed(1)} hrs`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.floor(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
  };

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Era</th>
            <th>Start Session</th>
            <th>End Session</th>
            <th>Sessions</th>
            <th>Duration</th>
            <th>Start Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {eras.map((era) => (
            <tr
              key={era.eraId}
              className={`clickable ${newEraIds.has(era.eraId) ? 'new-row' : ''}`}
              onClick={() => setSelectedEraId(era.eraId)}
              title="Click to view era details"
            >
              <td>
                <strong>#{era.eraId}</strong>
              </td>
              <td>{era.sessionStart || '—'}</td>
              <td>{era.sessionEnd || '—'}</td>
              <td>
                <strong>{getSessionsCount(era)}</strong>
              </td>
              <td>{formatDuration(era)}</td>
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

      {/* Era Details Modal */}
      {selectedEraId && (
        <EraDetailsModal
          eraId={selectedEraId}
          onClose={() => setSelectedEraId(null)}
        />
      )}
    </>
  );
};
