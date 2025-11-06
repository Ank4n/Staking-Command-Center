import { useState, useEffect, useRef } from 'react';
import { useEvents, useStatus } from '../hooks/useApi';
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
                {(() => {
                  const parsedEvent = JSON.parse(event.data);
                  const data = parsedEvent.data || parsedEvent;
                  const fullEventType = event.eventType;

                  // Helper to format large numbers with scientific notation
                  const formatLargeNumber = (planckStr: string, decimals: number = 10): string => {
                    const planck = BigInt(planckStr.replace(/,/g, ''));
                    const tokens = Number(planck) / Math.pow(10, decimals);
                    const exp = Math.floor(Math.log10(tokens));
                    const mantissa = tokens / Math.pow(10, exp);
                    if (tokens < 1000) return tokens.toFixed(1);
                    return `${mantissa.toFixed(1)}e${exp}`;
                  };

                  // SessionReportReceived
                  if (fullEventType.includes('SessionReportReceived')) {
                    const parts: string[] = [];
                    if (data.endIndex) parts.push(`Ended Session: ${data.endIndex}`);
                    if (data.activationTimestamp && Array.isArray(data.activationTimestamp)) {
                      parts.push(`New Era: ${data.activationTimestamp[1]}`);
                    }
                    if (data.validatorPointsCounts) parts.push(`Validators: ${data.validatorPointsCounts}`);
                    return parts.join(' | ');
                  }

                  // EraPaid
                  if (fullEventType.includes('EraPaid')) {
                    const parts: string[] = [];
                    if (data.eraIndex) parts.push(`Era: ${data.eraIndex}`);
                    if (data.validatorPayout) {
                      const planck = BigInt(data.validatorPayout.replace(/,/g, ''));
                      const tokens = Number(planck) / 1e10;
                      parts.push(`Validators: ${tokens.toLocaleString(undefined, {maximumFractionDigits: 2})} DOT`);
                    }
                    if (data.remainder) {
                      const planck = BigInt(data.remainder.replace(/,/g, ''));
                      const tokens = Number(planck) / 1e10;
                      parts.push(`Treasury: ${tokens.toLocaleString(undefined, {maximumFractionDigits: 2})} DOT`);
                    }
                    return parts.join(' | ');
                  }

                  // EraPruned
                  if (fullEventType.includes('EraPruned')) {
                    if (data.index) return `Era: ${data.index}`;
                  }

                  // PhaseTransitioned
                  if (fullEventType.includes('PhaseTransitioned')) {
                    const getPhase = (phaseData: any): string => {
                      if (!phaseData) return '?';
                      if (typeof phaseData === 'string') return phaseData;
                      if (typeof phaseData === 'object' && phaseData !== null) {
                        const keys = Object.keys(phaseData);
                        if (keys.length > 0) return keys[0];
                      }
                      return '?';
                    };
                    const from = getPhase(data.from);
                    const to = getPhase(data.to);
                    return `${from} → ${to}`;
                  }

                  // Registered
                  if (fullEventType.includes('Registered')) {
                    if (Array.isArray(data) && data.length >= 3) {
                      const parts: string[] = [`R${data[0]}`];
                      const score = data[2];
                      if (score) {
                        if (score.minimalStake) parts.push(`Min: ${formatLargeNumber(score.minimalStake)}`);
                        if (score.sumStake) parts.push(`Sum: ${formatLargeNumber(score.sumStake)}`);
                        if (score.sumStakeSquared) parts.push(`SumSq: ${formatLargeNumber(score.sumStakeSquared)}`);
                      }
                      return parts.join(' | ');
                    }
                  }

                  // Rewarded
                  if (fullEventType.includes('Rewarded')) {
                    if (Array.isArray(data) && data.length >= 3) {
                      const address = data[1];
                      const first = address.substring(0, 2);
                      const last = address.substring(address.length - 2);
                      const planck = BigInt(data[2].replace(/,/g, ''));
                      const tokens = Number(planck) / 1e10;
                      return `R${data[0]} | Acc: ${first}....${last} | Amt: ${tokens.toFixed(1)} DOT`;
                    }
                  }

                  // Stored
                  if (fullEventType.includes('.Stored')) {
                    if (Array.isArray(data) && data.length >= 3) {
                      const address = data[1];
                      const first = address.substring(0, 2);
                      const last = address.substring(address.length - 2);
                      return `R${data[0]} | Acc: ${first}....${last} | Page: ${data[2]}`;
                    }
                  }

                  // Discarded
                  if (fullEventType.includes('Discarded')) {
                    if (Array.isArray(data) && data.length >= 2) {
                      const address = data[1];
                      const first = address.substring(0, 2);
                      const last = address.substring(address.length - 2);
                      return `R${data[0]} | Acc: ${first}....${last}`;
                    }
                  }

                  // Queued
                  if (fullEventType.includes('Queued')) {
                    if (Array.isArray(data) && data.length >= 1 && data[0]) {
                      const score = data[0];
                      const parts: string[] = [];
                      if (score) {
                        if (score.minimalStake) parts.push(`Min: ${formatLargeNumber(score.minimalStake)}`);
                        if (score.sumStake) parts.push(`Sum: ${formatLargeNumber(score.sumStake)}`);
                        if (score.sumStakeSquared) parts.push(`SumSq: ${formatLargeNumber(score.sumStakeSquared)}`);
                      }
                      return parts.join(' | ');
                    }
                  }

                  // Verified
                  if (fullEventType.includes('Verified')) {
                    if (Array.isArray(data) && data.length >= 2) {
                      return `Page: ${data[0]}, Winners: ${data[1]}`;
                    }
                  }

                  // PagedElectionProceeded
                  if (fullEventType.includes('PagedElectionProceeded')) {
                    const parts: string[] = [];
                    if (data.page) parts.push(`Page: ${data.page}`);
                    if (data.result) {
                      const resultType = Object.keys(data.result)[0];
                      const resultValue = data.result[resultType];
                      parts.push(`${resultType}: ${resultValue}`);
                    }
                    return parts.join(' | ');
                  }

                  // NewSession
                  if (fullEventType.includes('NewSession')) {
                    if (data.sessionIndex) return `Session: ${data.sessionIndex}`;
                  }

                  // ValidatorSetReceived
                  if (fullEventType.includes('ValidatorSetReceived')) {
                    const parts: string[] = [];
                    if (data.id) parts.push(`Era: ${data.id}`);
                    if (data.newValidatorSetCount) parts.push(`Validators: ${data.newValidatorSetCount}`);
                    return parts.join(' | ');
                  }

                  // Default
                  const meaningfulEntries = Object.entries(data)
                    .filter(([k, v]) => !['method', 'section', 'index'].includes(k) && v !== null && v !== undefined)
                    .slice(0, 3);
                  if (meaningfulEntries.length === 0) return JSON.stringify(data);
                  return meaningfulEntries.map(([k, v]) => {
                    const strValue = typeof v === 'object' ? JSON.stringify(v) : String(v);
                    return `${k}: ${strValue.length > 30 ? strValue.substring(0, 30) + '...' : strValue}`;
                  }).join(' | ');
                })()}
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
