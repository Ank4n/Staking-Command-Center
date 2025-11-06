import { useState, useEffect, useRef } from 'react';
import { useEvents, useStatus } from '../hooks/useApi';
import { formatEventData } from '../utils/eventFormatters';
import type { BlockchainEvent } from '@staking-cc/shared';

export const EventsTab: React.FC = () => {
  const [activeChain, setActiveChain] = useState<'rc' | 'ah'>('ah');
  const [searchTerm, setSearchTerm] = useState('');
  const { events, loading, refetch } = useEvents(activeChain, 500);
  const { status } = useStatus();
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const previousEventsRef = useRef<Set<string>>(new Set());
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

  // Detect new events and mark them for animation
  useEffect(() => {
    const currentEventIds = new Set(events.map(e => `${e.blockNumber}-${e.id}`));
    const newEvents = new Set<string>();

    currentEventIds.forEach(eventId => {
      if (!previousEventsRef.current.has(eventId)) {
        newEvents.add(eventId);
      }
    });

    if (newEvents.size > 0) {
      setNewEventIds(newEvents);
      // Remove animation class after 3 seconds (animation duration)
      setTimeout(() => setNewEventIds(new Set()), 3000);
    }

    previousEventsRef.current = currentEventIds;
  }, [events]);

  const getSubscanUrl = (eventId: string) => {
    if (!status) return '#';
    const chain = status.chain;

    // Use different subscan URLs for Relay Chain vs Asset Hub
    let baseUrl: string;
    if (activeChain === 'ah') {
      // Asset Hub subscan URLs
      baseUrl = chain === 'kusama'
        ? 'https://assethub-kusama.subscan.io'
        : chain === 'polkadot'
        ? 'https://assethub-polkadot.subscan.io'
        : 'https://assethub-westend.subscan.io';
    } else {
      // Relay Chain subscan URLs
      baseUrl = chain === 'kusama'
        ? 'https://kusama.subscan.io'
        : chain === 'polkadot'
        ? 'https://polkadot.subscan.io'
        : 'https://westend.subscan.io';
    }

    return `${baseUrl}/event/${eventId}`;
  };

  const filteredEvents = events.filter((event) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      event.eventType.toLowerCase().includes(searchLower) ||
      event.eventId.includes(searchTerm) ||
      event.blockNumber.toString().includes(searchTerm)
    );
  });

  const renderEventsTable = (events: BlockchainEvent[]) => {
    if (loading) {
      return (
        <div className="loading">
          <div className="loading-spinner" />
          <div>Loading {activeChain === 'rc' ? 'Relay Chain' : 'Asset Hub'} events...</div>
        </div>
      );
    }

    if (events.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">🎯</div>
          <div>No events found</div>
        </div>
      );
    }

    return (
      <table className="table">
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Block</th>
            <th>Event Type</th>
            <th>Data (Preview)</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={`${event.blockNumber}-${event.id}`}
              className={newEventIds.has(`${event.blockNumber}-${event.id}`) ? 'new-row' : ''}
            >
              <td>
                <a
                  href={getSubscanUrl(event.eventId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0066cc', textDecoration: 'none' }}
                >
                  {event.eventId}
                </a>
              </td>
              <td>#{event.blockNumber.toLocaleString()}</td>
              <td>
                <code style={{ fontSize: '0.85rem' }}>
                  {(() => {
                    const [pallet, eventName] = event.eventType.split('.');
                    return (
                      <>
                        <span style={{ color: '#a78bfa' }}>{pallet}</span>
                        <span style={{ color: '#888' }}>.</span>
                        <span style={{ color: '#60a5fa' }}>{eventName}</span>
                      </>
                    );
                  })()}
                </code>
              </td>
              <td style={{ fontSize: '12px', color: '#888', minWidth: '300px', maxWidth: '600px' }}>
                {formatEventData(event.eventType, event.data)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
          <button
            className={`btn ${activeChain === 'rc' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveChain('rc')}
          >
            Relay Chain Events
          </button>
          <button
            className={`btn ${activeChain === 'ah' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveChain('ah')}
          >
            Asset Hub Events
          </button>
          <input
            type="text"
            placeholder="Search by event type, ID, or block..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              flex: 1,
              minWidth: '200px'
            }}
          />
        </div>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          Showing {filteredEvents.length} of {events.length} events
        </div>
      </div>

      {renderEventsTable(filteredEvents)}
    </div>
  );
};
