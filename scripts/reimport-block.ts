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
                  sessionEnd: sessionId, // Session that just ended when new era starts
                });
                logger.info({
                  previousEraId: previousEra.eraId,
                  sessionEnd: sessionId,
                  newEraId: eraId
                }, 'Era transition: Updated previous era');
              }

              // Create new era
              db.upsertEra({
                eraId: eraId!,
                sessionStart: sessionId + 1,
                sessionEnd: null,
                startTime: activationTimestamp,
              });
              logger.info({
                eraId,
                sessionStart: sessionId + 1,
                startTime: activationTimestamp,
                previousEraEnded: previousEra ? sessionId : null
              }, 'Created new era');
            }
          }

          // Query era information from Asset Hub at block n-1 for the ENDING session
          const queryBlockNumberForEndingSession = Math.max(1, blockNumber - 1);
          let activeEraIdForEndingSession: number | null = null;
          let plannedEraIdForEndingSession: number | null = null;

          try {
            const queryBlockHash = await api.rpc.chain.getBlockHash(queryBlockNumberForEndingSession);
            const apiAtQuery = await api.at(queryBlockHash);

            // Get active era
            const activeEraOption = await apiAtQuery.query.staking?.activeEra?.();
            logger.info({
              sessionId,
              queryBlockNumber: queryBlockNumberForEndingSession,
              hasActiveEra: !!activeEraOption,
              isEmpty: activeEraOption?.isEmpty,
              activeEraRaw: activeEraOption?.toString()
            }, 'Querying activeEra from Asset Hub for ending session');

            if (activeEraOption && !activeEraOption.isEmpty) {
              const activeEra = (activeEraOption as any).toJSON();
              activeEraIdForEndingSession = activeEra?.index || null;
              logger.info({ activeEra, activeEraId: activeEraIdForEndingSession }, 'Parsed activeEra for ending session');
            }

            // Get planned era (currentEra)
            const currentEraOption = await apiAtQuery.query.staking?.currentEra?.();
            logger.info({
              sessionId,
              queryBlockNumber: queryBlockNumberForEndingSession,
              hasCurrentEra: !!currentEraOption,
              isEmpty: currentEraOption?.isEmpty,
              currentEraRaw: currentEraOption?.toString()
            }, 'Querying currentEra from Asset Hub for ending session');

            if (currentEraOption && !currentEraOption.isEmpty) {
              // currentEra returns a plain number codec, not an object like activeEra
              // Use toJSON() to get the numeric value
              const asAny = currentEraOption as any;
              plannedEraIdForEndingSession = typeof asAny.toJSON === 'function' ? asAny.toJSON() : null;
              logger.info({ plannedEraId: plannedEraIdForEndingSession }, 'Parsed currentEra for ending session');
            }
          } catch (e) {
            logger.error({ error: e, sessionId, queryBlockNumber: queryBlockNumberForEndingSession }, 'Error querying era info from Asset Hub for ending session');
          }

          // Create/update the ENDING session (sessionId = endIndex)
          db.upsertSession({
            sessionId,
            blockNumber,
            activationTimestamp,
            activeEraId: activeEraIdForEndingSession,
            plannedEraId: plannedEraIdForEndingSession,
            validatorPointsTotal: totalPoints,
          });
          logger.info({ sessionId, activeEraId: activeEraIdForEndingSession, plannedEraId: plannedEraIdForEndingSession, totalPoints }, 'Ending session created/updated');

          // Create the STARTING session (sessionId = endIndex + 1)
          const nextSessionId = sessionId + 1;
          let activeEraIdForStartingSession: number | null = null;
          let plannedEraIdForStartingSession: number | null = null;

          try {
            const currentBlockHash = await api.rpc.chain.getBlockHash(blockNumber);
            const apiAtCurrent = await api.at(currentBlockHash);

            // Get active era for the starting session
            const activeEraOptionCurrent = await apiAtCurrent.query.staking?.activeEra?.();
            logger.info({
              sessionId: nextSessionId,
              queryBlockNumber: blockNumber,
              hasActiveEra: !!activeEraOptionCurrent,
              isEmpty: activeEraOptionCurrent?.isEmpty,
              activeEraRaw: activeEraOptionCurrent?.toString()
            }, 'Querying activeEra from Asset Hub for starting session');

            if (activeEraOptionCurrent && !activeEraOptionCurrent.isEmpty) {
              const activeEra = (activeEraOptionCurrent as any).toJSON();
              activeEraIdForStartingSession = activeEra?.index || null;
              logger.info({ activeEra, activeEraId: activeEraIdForStartingSession }, 'Parsed activeEra for starting session');
            }

            // Get planned era (currentEra) for the starting session
            const currentEraOptionCurrent = await apiAtCurrent.query.staking?.currentEra?.();
            logger.info({
              sessionId: nextSessionId,
              queryBlockNumber: blockNumber,
              hasCurrentEra: !!currentEraOptionCurrent,
              isEmpty: currentEraOptionCurrent?.isEmpty,
              currentEraRaw: currentEraOptionCurrent?.toString()
            }, 'Querying currentEra from Asset Hub for starting session');

            if (currentEraOptionCurrent && !currentEraOptionCurrent.isEmpty) {
              const asAny = currentEraOptionCurrent as any;
              plannedEraIdForStartingSession = typeof asAny.toJSON === 'function' ? asAny.toJSON() : null;
              logger.info({ plannedEraId: plannedEraIdForStartingSession }, 'Parsed currentEra for starting session');
            }
          } catch (e) {
            logger.error({ error: e, sessionId: nextSessionId, queryBlockNumber: blockNumber }, 'Error querying era info from Asset Hub for starting session');
          }

          // Create the STARTING session with partial data (will be completed when this session ends)
          db.upsertSession({
            sessionId: nextSessionId,
            blockNumber: null, // Will be filled when this session ends
            activationTimestamp: null, // Will be filled if this session starts a new era
            activeEraId: activeEraIdForStartingSession,
            plannedEraId: plannedEraIdForStartingSession,
            validatorPointsTotal: 0, // Will be filled when this session ends
          });
          logger.info({ sessionId: nextSessionId, activeEraId: activeEraIdForStartingSession, plannedEraId: plannedEraIdForStartingSession }, 'Starting session created');
        }

        // Process PhaseTransitioned event (MultiBlockElection.PhaseTransitioned)
        if (eventType.toLowerCase() === 'multiblockelection.phasetransitioned') {
          logger.info({ eventType, blockNumber }, 'Processing PhaseTransitioned event');

          try {
            // Extract phase names properly (handle enum variants with associated data)
            const extractPhaseName = (phaseData: any): string => {
              if (!phaseData) return '';

              // If it's an enum type, check for .type property
              if (phaseData.type) {
                return phaseData.type;
              }

              // If it's already a string, use it
              if (typeof phaseData === 'string') {
                return phaseData;
              }

              // If toString gives us JSON like {"export":14}, extract the key
              const str = phaseData.toString();
              if (str.startsWith('{')) {
                try {
                  const parsed = JSON.parse(str);
                  const keys = Object.keys(parsed);
                  if (keys.length > 0) {
                    // Capitalize first letter
                    return keys[0].charAt(0).toUpperCase() + keys[0].slice(1);
                  }
                } catch (e) {
                  // Fall through
                }
              }

              return str;
            };

            const fromPhase = extractPhaseName(event.data.from);
            const toPhase = extractPhaseName(event.data.to);

            logger.info({ fromPhase, toPhase, blockNumber }, 'Phase transition detected');

            // Query round number
            const round = await apiAt.query.multiBlockElection?.round?.();
            const roundNumber = round && typeof round.toNumber === 'function' ? round.toNumber() : 0;

            // Query active era for era_id (the era during which this phase is occurring, not the era being elected for)
            const activeEraOption = await apiAt.query.staking?.activeEra?.();
            let eraId: number | null = null;

            if (activeEraOption && !activeEraOption.isEmpty) {
              const activeEra = (activeEraOption as any).toJSON();
              eraId = activeEra?.index || null;
            }

            if (!eraId) {
              logger.warn({ blockNumber }, 'Could not get era_id for election phase');
              continue;
            }

            let phaseData: any = {
              eraId,
              round: roundNumber,
              phase: toPhase,
              blockNumber,
              eventId,
              timestamp: blockTimestamp,
            };

            // Query phase-specific data
            if (toPhase === 'Snapshot') {
              // Query validator and nominator counts
              const validatorCount = await apiAt.query.staking?.counterForValidators?.();
              const nominatorCount = await apiAt.query.staking?.counterForNominators?.();
              const targetValidatorCount = await apiAt.query.staking?.validatorCount?.();

              phaseData.validatorCandidates = validatorCount && typeof validatorCount.toNumber === 'function' ? validatorCount.toNumber() : null;
              phaseData.nominatorCandidates = nominatorCount && typeof nominatorCount.toNumber === 'function' ? nominatorCount.toNumber() : null;
              phaseData.targetValidatorCount = targetValidatorCount && typeof targetValidatorCount.toNumber === 'function' ? targetValidatorCount.toNumber() : null;

              logger.info({
                validatorCandidates: phaseData.validatorCandidates,
                nominatorCandidates: phaseData.nominatorCandidates,
                targetValidatorCount: phaseData.targetValidatorCount
              }, 'Snapshot phase data');
            }

            if (toPhase === 'Signed') {
              // Query sorted scores and minimum score
              const sortedScoresCodec = await apiAt.query.multiBlockElectionSigned?.sortedScores?.(roundNumber);
              const minimumScoreCodec = await apiAt.query.multiBlockElectionVerifier?.minimumScore?.();

              if (sortedScoresCodec) {
                const sortedScores = sortedScoresCodec.toJSON();
                // Get top 5 scores
                const top5 = Array.isArray(sortedScores) ? sortedScores.slice(0, 5) : [];
                phaseData.sortedScores = JSON.stringify(top5);
              }

              if (minimumScoreCodec && !minimumScoreCodec.isEmpty) {
                phaseData.minimumScore = minimumScoreCodec.toString();
              }

              logger.info({ sortedScores: phaseData.sortedScores, minimumScore: phaseData.minimumScore }, 'Signed phase data');
            }

            if (toPhase === 'SignedValidation') {
              // Query queued solution score
              const queuedScoreCodec = await apiAt.query.multiBlockElectionVerifier?.queuedSolutionScore?.(roundNumber);

              if (queuedScoreCodec && !queuedScoreCodec.isEmpty) {
                phaseData.queuedSolutionScore = queuedScoreCodec.toString();
              }

              logger.info({ queuedSolutionScore: phaseData.queuedSolutionScore }, 'SignedValidation phase data');
            }

            if (toPhase === 'Off' && fromPhase === 'Export') {
              // Query elected validators at block n-1
              const queryBlockNumber = Math.max(1, blockNumber - 1);
              const queryBlockHash = await api.rpc.chain.getBlockHash(queryBlockNumber);
              const apiAtQuery = await api.at(queryBlockHash);

              const electableStashes = await apiAtQuery.query.staking?.electableStashes?.();

              if (electableStashes) {
                const stashesList = electableStashes.toJSON();
                phaseData.validatorsElected = Array.isArray(stashesList) ? stashesList.length : 0;

                // Also update the era table
                db.updateEraValidatorCount(eraId, phaseData.validatorsElected);
              }

              logger.info({ validatorsElected: phaseData.validatorsElected }, 'Export→Off transition data');
            }

            // Check if era exists before inserting (to avoid foreign key constraint)
            const existingEra = db.getEra(eraId);
            if (!existingEra) {
              logger.warn({
                eraId,
                phase: toPhase,
                blockNumber,
                message: 'Era does not exist yet, skipping election phase insert. Will be populated when era is created.'
              }, 'Skipping election phase - era not found');
            } else {
              // Insert election phase
              db.insertElectionPhase(phaseData);
              logger.info({ phase: toPhase, eraId, round: roundNumber }, 'Inserted election phase');
            }

          } catch (error) {
            logger.error({ error, blockNumber, eventType }, 'Error processing PhaseTransitioned event');
          }
        }

        // Process EraPaid event (Staking.EraPaid)
        if (eventType.toLowerCase() === 'staking.erapaid') {
          logger.info({ eventType, blockNumber }, 'Processing EraPaid event');

          try {
            const eraIndex = event.data.eraIndex ? event.data.eraIndex.toNumber() : null;
            const validatorPayout = event.data.validatorPayout ? event.data.validatorPayout.toString() : '0';
            const remainder = event.data.remainder ? event.data.remainder.toString() : '0';

            if (eraIndex === null) {
              logger.warn({ blockNumber }, 'EraPaid missing eraIndex');
              continue;
            }

            // Calculate total inflation
            const validatorBigInt = BigInt(validatorPayout);
            const remainderBigInt = BigInt(remainder);
            const totalInflation = (validatorBigInt + remainderBigInt).toString();

            // Update era inflation data
            db.updateEraInflation(eraIndex, totalInflation, validatorPayout, remainder);

            logger.info({
              eraIndex,
              totalInflation,
              validatorPayout,
              treasury: remainder
            }, 'Updated era inflation');

          } catch (error) {
            logger.error({ error, blockNumber, eventType }, 'Error processing EraPaid event');
          }
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
