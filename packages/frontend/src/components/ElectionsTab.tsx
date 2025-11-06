import { useState, useCallback } from 'react';
import { useElectionWinners } from '../hooks/useApi';
import { formatLargeNumber } from '../utils/eventFormatters';

export const ElectionsTab: React.FC = () => {
  const { winners, loading, error } = useElectionWinners(20);
  const [minimumScore, setMinimumScore] = useState<string | null>(null);
  const [loadingMinScore, setLoadingMinScore] = useState(false);
  const [minScoreFetched, setMinScoreFetched] = useState(false);

  const shortenAddress = (address: string): string => {
    if (address.length < 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  // Fetch minimum score from chain (cached, manual refresh)
  const fetchMinimumScore = useCallback(async () => {
    try {
      setLoadingMinScore(true);
      const API_BASE_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE_URL}/api/elections/minimum-score`);

      if (!response.ok) {
        throw new Error('Failed to fetch minimum score');
      }

      const data = await response.json();

      if (data.minimumScore) {
        const score = JSON.parse(data.minimumScore);
        // Format as: Min: X | Sum: Y | Sum²: Z
        const formatted = [
          `Min: ${formatLargeNumber(score.minimalStake)}`,
          `Sum: ${formatLargeNumber(score.sumStake)}`,
          `Sum²: ${formatLargeNumber(score.sumStakeSquared)}`
        ].join(' | ');
        setMinimumScore(formatted);
        setMinScoreFetched(true);
      } else {
        setMinimumScore(null);
        setMinScoreFetched(true);
      }
    } catch (err) {
      console.error('Failed to fetch minimum score:', err);
      setMinimumScore(null);
      setMinScoreFetched(true);
    } finally {
      setLoadingMinScore(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div>Loading election winners...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">❌</div>
        <div>Error loading election winners</div>
        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Sticky minimum score header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: '#1a1a1a',
        padding: '15px 0 20px 0',
        marginBottom: '0px',
        borderBottom: '2px solid #333'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>
            Current Minimum Score
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: loadingMinScore ? '#666' : '#667eea', fontFamily: minimumScore ? 'monospace' : 'inherit' }}>
              {loadingMinScore ? 'Loading...' : (minScoreFetched ? (minimumScore || 'Not available') : 'Click to load →')}
            </div>
            <button
              onClick={fetchMinimumScore}
              disabled={loadingMinScore}
              aria-label="Refresh minimum score from chain"
              style={{
                background: 'none',
                border: 'none',
                cursor: loadingMinScore ? 'not-allowed' : 'pointer',
                padding: '4px 8px',
                fontSize: '1rem',
                color: loadingMinScore ? '#444' : '#667eea',
                opacity: loadingMinScore ? 0.5 : 1
              }}
              title="Refresh minimum score from chain"
            >
              🔄
            </button>
          </div>
        </div>
      </div>

      {winners.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗳️</div>
          <div>No election winners yet</div>
          <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
            Winners will appear here once elections complete
          </div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Era</th>
              <th>Submitter</th>
              <th>Minimal Stake</th>
              <th>Sum Stake</th>
              <th>Sum² Stake</th>
              <th>Block</th>
            </tr>
          </thead>
          <tbody>
            {winners.map((winner) => (
              <tr key={winner.id}>
                <td>
                  <strong>#{winner.round}</strong>
                </td>
                <td>{winner.eraId || '—'}</td>
                <td>
                  <span
                    style={{ fontFamily: 'monospace' }}
                    title={winner.submitter}
                  >
                    {shortenAddress(winner.submitter)}
                  </span>
                </td>
                <td>{formatLargeNumber(winner.minimalStake)}</td>
                <td>{formatLargeNumber(winner.sumStake)}</td>
                <td>
                  {formatLargeNumber(winner.sumStakeSquared)}
                </td>
                <td>#{winner.blockNumber.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
