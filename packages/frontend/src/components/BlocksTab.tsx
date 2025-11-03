import { useState } from 'react';
import { useBlocks } from '../hooks/useApi';
import type { Block } from '@staking-cc/shared';

export const BlocksTab: React.FC = () => {
  const [activeChain, setActiveChain] = useState<'rc' | 'ah'>('rc');
  const { blocks, loading, refetch } = useBlocks(activeChain, 50);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const renderBlocksTable = (blocks: Block[], chain: string) => {
    if (loading) {
      return (
        <div className="loading">
          <div className="loading-spinner" />
          <div>Loading {chain} blocks...</div>
        </div>
      );
    }

    if (blocks.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <div>No blocks available yet</div>
        </div>
      );
    }

    return (
      <table className="table">
        <thead>
          <tr>
            <th>Block Number</th>
            <th>Timestamp</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block.blockNumber}>
              <td>
                <strong>#{block.blockNumber.toLocaleString()}</strong>
              </td>
              <td>{formatTimestamp(block.timestamp)}</td>
              <td>{new Date(block.timestamp).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
          <button
            className={`btn ${activeChain === 'rc' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveChain('rc')}
          >
            Relay Chain Blocks
          </button>
          <button
            className={`btn ${activeChain === 'ah' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveChain('ah')}
          >
            Asset Hub Blocks
          </button>
          <button className="btn btn-secondary" onClick={refetch}>
            Refresh
          </button>
        </div>
      </div>

      {renderBlocksTable(blocks, activeChain === 'rc' ? 'Relay Chain' : 'Asset Hub')}
    </div>
  );
};
