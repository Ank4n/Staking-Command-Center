import { useState, useEffect, useRef } from 'react';
import { useBlocks, useStatus } from '../hooks/useApi';
import type { Block } from '@staking-cc/shared';

export const BlocksTab: React.FC = () => {
  const [activeChain, setActiveChain] = useState<'rc' | 'ah'>('rc');
  const { blocks, loading, refetch } = useBlocks(activeChain, 50);
  const { status } = useStatus();
  const [newBlockNumbers, setNewBlockNumbers] = useState<Set<number>>(new Set());
  const previousBlocksRef = useRef<Set<number>>(new Set());
  const previousChainBlockRef = useRef<number>(0);

  // Auto-refresh when new blocks arrive
  useEffect(() => {
    if (!status) return;

    const currentBlock = activeChain === 'rc'
      ? status.relayChain.lastBlockNumber
      : status.assetHub.lastBlockNumber;

    // Trigger refetch when a new block arrives
    if (currentBlock !== previousChainBlockRef.current && previousChainBlockRef.current !== 0) {
      refetch();
    }

    previousChainBlockRef.current = currentBlock;
  }, [status, activeChain, refetch]);

  // Fallback: also refresh every 6 seconds in case WebSocket misses updates
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 6000);

    return () => clearInterval(interval);
  }, [refetch]);

  // Detect new blocks and mark them for animation
  useEffect(() => {
    const currentBlockNumbers = new Set(blocks.map(b => b.blockNumber));
    const newBlocks = new Set<number>();

    currentBlockNumbers.forEach(blockNum => {
      if (!previousBlocksRef.current.has(blockNum)) {
        newBlocks.add(blockNum);
      }
    });

    if (newBlocks.size > 0) {
      setNewBlockNumbers(newBlocks);
      // Remove animation class after 3 seconds (animation duration)
      setTimeout(() => setNewBlockNumbers(new Set()), 3000);
    }

    previousBlocksRef.current = currentBlockNumbers;
  }, [blocks]);

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
            <tr
              key={block.blockNumber}
              className={newBlockNumbers.has(block.blockNumber) ? 'new-row' : ''}
            >
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
        </div>
      </div>

      {renderBlocksTable(blocks, activeChain === 'rc' ? 'Relay Chain' : 'Asset Hub')}
    </div>
  );
};
