#!/usr/bin/env tsx
/**
 * Script to reimport a specific block for reprocessing
 * Usage: tsx scripts/reimport-block.ts <chain> <blockNumber>
 * Example: tsx scripts/reimport-block.ts ah 11501414
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import Database from 'better-sqlite3';
import { StakingDatabase } from '../packages/indexer/src/database';
import { logger } from '../packages/indexer/src/utils/logger';

const CHAIN = process.env.CHAIN || 'kusama';

const RPC_ENDPOINTS = {
  kusama: {
    rc: ['wss://kusama-rpc.n.dwellir.com', 'wss://kusama.api.onfinality.io/public-ws'],
    ah: ['wss://asset-hub-kusama-rpc.n.dwellir.com', 'wss://statemine-rpc-tn.dwellir.com'],
  },
  polkadot: {
    rc: ['wss://polkadot-rpc.n.dwellir.com', 'wss://polkadot.api.onfinality.io/public-ws'],
    ah: ['wss://asset-hub-polkadot-rpc.n.dwellir.com', 'wss://statemint-rpc-tn.dwellir.com'],
  },
};

async function reimportBlock(chain: 'rc' | 'ah', blockNumber: number) {
  logger.info({ chain, blockNumber }, 'Starting block reimport');

  // Open database
  const dbPath = `./data/staking-${CHAIN}.db`;
  const db = new StakingDatabase(dbPath, logger);

  // Connect to RPC
  const endpoints = RPC_ENDPOINTS[CHAIN as 'kusama' | 'polkadot'];
  const rpcEndpoint = chain === 'rc' ? endpoints.rc[0] : endpoints.ah[0];

  logger.info({ rpcEndpoint }, 'Connecting to RPC');
  const provider = new WsProvider(rpcEndpoint);
  const api = await ApiPromise.create({ provider });

  try {
    // Delete existing block and events
    if (chain === 'rc') {
      logger.info({ blockNumber }, 'Deleting existing RC block and events');
      db.deleteBlockRC(blockNumber);
    } else {
      logger.info({ blockNumber }, 'Deleting existing AH block and events');
      db.deleteBlockAH(blockNumber);
    }

    // Get block hash
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const apiAt = await api.at(blockHash);

    // Get block timestamp
    const timestamp = await apiAt.query.timestamp.now();
    const blockTimestamp = (timestamp as any).toNumber();

    // Insert block
    if (chain === 'rc') {
      logger.info({ blockNumber, timestamp: blockTimestamp }, 'Inserting RC block');
      db.insertBlockRC({ blockNumber, timestamp: blockTimestamp });
    } else {
      logger.info({ blockNumber, timestamp: blockTimestamp }, 'Inserting AH block');
      db.insertBlockAH({ blockNumber, timestamp: blockTimestamp });
    }

    // Get and process events
    const eventsCodec = await apiAt.query.system.events();
    const events = eventsCodec as unknown as any[];

    logger.info({ blockNumber, eventCount: events.length }, 'Processing events');

    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const record = events[eventIndex];
      const { event } = record;
      const eventType = `${event.section}.${event.method}`;
      const eventId = `${blockNumber}-${eventIndex}`;

      // Import event filters
      const { shouldTrackEventRC, shouldTrackEventAH } = await import('../packages/indexer/src/utils/eventFilters');

      // Check if event should be tracked
      const shouldTrack = chain === 'rc' ? shouldTrackEventRC(eventType) : shouldTrackEventAH(eventType);

      if (!shouldTrack) {
        continue;
      }

      logger.info({ eventType, eventId }, 'Storing event');

      if (chain === 'rc') {
        db.insertEventRC({
          blockNumber,
          eventId,
          eventType,
          data: JSON.stringify(event.toHuman()),
        });
      } else {
        db.insertEventAH({
          blockNumber,
          eventId,
          eventType,
          data: JSON.stringify(event.toHuman()),
        });

        // Process special events for sessions/eras (AH only)
        if (eventType.toLowerCase() === 'stakingrcclient.sessionreportreceived') {
          logger.info({ eventType, blockNumber }, 'Processing SessionReportReceived event');

          // Extract event data
          const endIndex = event.data.endIndex ? event.data.endIndex.toNumber() : null;
          const totalPoints = event.data.validatorPointsCounts ? event.data.validatorPointsCounts.toNumber() : 0;
          // Check if activationTimestamp exists and is not empty/null
          // activationTimestamp is Option<(Moment, EraIndex)> - a tuple with timestamp and era_id
          let activationTimestamp: number | null = null;
          let eraIdFromTimestamp: number | null = null;
          try {
            const tsField = event.data.activationTimestamp;
            if (tsField) {
              // Check if it's an Option type
              if (typeof tsField.isSome !== 'undefined' && !tsField.isSome) {
                // None
                activationTimestamp = null;
              } else if (typeof tsField.isEmpty !== 'undefined' && tsField.isEmpty) {
                // Empty
                activationTimestamp = null;
              } else if (typeof tsField.unwrap === 'function') {
                // It's an Option with Some value - unwrap it
                const unwrapped = tsField.unwrap();
                // unwrapped should be a tuple (Moment, EraIndex)
                if (unwrapped && unwrapped.length >= 2) {
                  const timestamp = unwrapped[0];
                  const eraIdx = unwrapped[1];
                  activationTimestamp = timestamp && typeof timestamp.toNumber === 'function' ? timestamp.toNumber() : null;
                  eraIdFromTimestamp = eraIdx && typeof eraIdx.toNumber === 'function' ? eraIdx.toNumber() : null;
                  logger.info({ activationTimestamp, eraIdFromTimestamp }, 'Extracted from tuple');
                }
              }
            }
          } catch (e) {
            logger.debug({ error: e }, 'Error extracting activationTimestamp');
            activationTimestamp = null;
          }

          if (endIndex === null) {
            logger.warn({ blockNumber }, 'SessionReportReceived missing endIndex');
            continue;
          }

          const sessionId = endIndex;
          const isEraStart = activationTimestamp !== null;

          logger.info({ sessionId, totalPoints, activationTimestamp, isEraStart }, 'SessionReportReceived details');

          // If this is an era start, create/update era
          let eraId: number | null = null;
          if (isEraStart && activationTimestamp !== null && eraIdFromTimestamp !== null) {
            // Use the era_id from the activationTimestamp tuple
            eraId = eraIdFromTimestamp;

            if (eraId !== null) {

              // Update previous era's end session
              const previousEra = db.getLatestEra();
              if (previousEra && previousEra.sessionEnd === null) {
                db.upsertEra({
                  ...previousEra,
                  sessionEnd: sessionId - 1,
                });
                logger.info({ previousEraId: previousEra.eraId, sessionEnd: sessionId - 1 }, 'Updated previous era');
              }

              // Create new era
              db.upsertEra({
                eraId: eraId!,
                sessionStart: sessionId + 1,
                sessionEnd: null,
                startTime: activationTimestamp,
              });
              logger.info({ eraId, sessionStart: sessionId + 1, startTime: activationTimestamp }, 'Created new era');
            }
          }

          // Query era information from Asset Hub at block n-1 (as per CLAUDE.md instructions)
          const queryBlockNumber = Math.max(1, blockNumber - 1);
          let activeEraId: number | null = null;
          let plannedEraId: number | null = null;

          try {
            const queryBlockHash = await api.rpc.chain.getBlockHash(queryBlockNumber);
            const apiAtQuery = await api.at(queryBlockHash);

            // Get active era
            const activeEraOption = await apiAtQuery.query.staking?.activeEra?.();
            logger.info({
              sessionId,
              queryBlockNumber,
              hasActiveEra: !!activeEraOption,
              isEmpty: activeEraOption?.isEmpty,
              activeEraRaw: activeEraOption?.toString()
            }, 'Querying activeEra from Asset Hub');

            if (activeEraOption && !activeEraOption.isEmpty) {
              const activeEra = (activeEraOption as any).toJSON();
              activeEraId = activeEra?.index || null;
              logger.info({ activeEra, activeEraId }, 'Parsed activeEra');
            }

            // Get planned era (currentEra)
            const currentEraOption = await apiAtQuery.query.staking?.currentEra?.();
            logger.info({
              sessionId,
              queryBlockNumber,
              hasCurrentEra: !!currentEraOption,
              isEmpty: currentEraOption?.isEmpty,
              currentEraRaw: currentEraOption?.toString(),
              type: typeof currentEraOption,
              keys: currentEraOption ? Object.keys(currentEraOption) : []
            }, 'Querying currentEra from Asset Hub');

            if (currentEraOption && !currentEraOption.isEmpty) {
              // currentEra returns a plain number codec, not an object like activeEra
              // Use toJSON() to get the numeric value
              const asAny = currentEraOption as any;
              plannedEraId = typeof asAny.toJSON === 'function' ? asAny.toJSON() : null;
              logger.info({ plannedEraId }, 'Parsed currentEra');
            }
          } catch (e) {
            logger.error({ error: e, sessionId, queryBlockNumber }, 'Error querying era info from Asset Hub');
          }

          // Create/update session
          db.upsertSession({
            sessionId,
            blockNumber,
            activationTimestamp,
            activeEraId,
            plannedEraId,
            validatorPointsTotal: totalPoints,
          });
          logger.info({ sessionId, activeEraId, plannedEraId, totalPoints }, 'Created/updated session');
        }
      }
    }

    logger.info({ blockNumber, chain, eventsProcessed: events.length }, 'Block reimport completed successfully');

  } catch (error) {
    logger.error({ error, blockNumber, chain }, 'Error reimporting block');
    throw error;
  } finally {
    await api.disconnect();
    db.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: tsx scripts/reimport-block.ts <chain> <blockNumber>');
  console.error('  chain: rc or ah');
  console.error('  blockNumber: the block number to reimport');
  console.error('Example: tsx scripts/reimport-block.ts ah 11501414');
  process.exit(1);
}

const chain = args[0].toLowerCase();
if (chain !== 'rc' && chain !== 'ah') {
  console.error('Invalid chain. Must be "rc" or "ah"');
  process.exit(1);
}

const blockNumber = parseInt(args[1], 10);
if (isNaN(blockNumber) || blockNumber < 0) {
  console.error('Invalid block number');
  process.exit(1);
}

// Run the reimport
reimportBlock(chain as 'rc' | 'ah', blockNumber)
  .then(() => {
    console.log('✅ Block reimport completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Block reimport failed:', error);
    process.exit(1);
  });
