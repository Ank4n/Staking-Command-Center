/**
 * Election Score Processing Tests
 * Tests for MultiBlockElectionSigned event handling (Registered, Rewarded, Slashed, etc.)
 */

import { Indexer } from '../../indexer/Indexer';
import { createTestDatabase } from '../utils/testDatabase';
import { createMockElectionScoreEvent, createMockApiAt } from '../fixtures/events';
import type { StakingDatabase } from '../../database/Database';
import type { ApiPromise } from '@polkadot/api';

describe('Election Score Event Processing', () => {
  let db: StakingDatabase;
  let indexer: Indexer;
  let mockApiRC: any;
  let mockApiAH: any;
  let mockLogger: any;

  beforeEach(() => {
    db = createTestDatabase();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(function(this: any) { return this; }),
    };

    mockApiRC = { rpc: {}, at: jest.fn() };
    mockApiAH = {
      rpc: {
        chain: {
          getBlockHash: jest.fn().mockResolvedValue('0xabcd1234'),
        },
      },
      at: jest.fn(),
    };

    indexer = new Indexer(mockApiRC as ApiPromise, mockApiAH as ApiPromise, db, mockLogger, 10);
  });

  afterEach(() => {
    db.close();
  });

  describe('Registered Event Processing', () => {
    it('should create election score from Registered event with full score data', async () => {
      // Setup: Create era for foreign key constraint
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Mock activeEra query
      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Real event structure from Polkadot: https://assethub-polkadot.subscan.io/event/10274762-4
      const event = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        score: {
          minimalStake: '9822834105182999',
          sumStake: '40914956818281800',
          sumStakeSquared: '249348803003456830000000000000000',
        },
      });

      // Process event
      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762);

      // Assertions
      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(1);

      const score = scores[0];
      expect(score.round).toBe(3964);
      expect(score.submitter).toBe('13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr');
      expect(score.minimalStake).toBe('9822834105182999');
      expect(score.sumStake).toBe('40914956818281800');
      expect(score.sumStakeSquared).toBe('249348803003456830000000000000000');
      expect(score.status).toBe('registered');
      expect(score.eraId).toBe(1982);
      expect(score.blockNumber).toBe(10274762);
    });

    it('should handle Registered event with array format (stored events)', async () => {
      // Setup
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Event stored as array [round, submitter, score]
      const event = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        score: {
          minimalStake: '9822834105182999',
          sumStake: '40914956818281800',
          sumStakeSquared: '249348803003456830000000000000000',
        },
        useArrayFormat: true,
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762);

      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(1);
      expect(scores[0].minimalStake).toBe('9822834105182999');
    });

    it('should handle very large stake values', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      // Extreme large values for stress testing
      const event = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        score: {
          minimalStake: '999999999999999999999999',
          sumStake: '999999999999999999999999',
          sumStakeSquared: '999999999999999999999999999999999999999999',
        },
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 11000000);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].minimalStake).toBe('999999999999999999999999');
      expect(scores[0].sumStakeSquared).toBe('999999999999999999999999999999999999999999');
    });
  });

  describe('Rewarded Event Processing', () => {
    it('should update status to rewarded when winner is announced', async () => {
      // Setup: Create era and initial registered score
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // First, register a submission
      db.upsertElectionScore({
        blockNumber: 10274762,
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '9822834105182999',
        sumStake: '40914956818281800',
        sumStakeSquared: '249348803003456830000000000000000',
        status: 'registered',
        eraId: 1982,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Now process Rewarded event: https://assethub-polkadot.subscan.io/event/10274936-4
      const event = createMockElectionScoreEvent({
        eventName: 'Rewarded',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Rewarded', 10274936);

      // Verify status changed to rewarded
      const winner = db.getElectionWinnerByRound(3964);
      expect(winner).not.toBeNull();
      expect(winner!.status).toBe('rewarded');
      expect(winner!.blockNumber).toBe(10274936); // Block updated
      expect(winner!.minimalStake).toBe('9822834105182999'); // Score preserved
    });

    it('should not overwrite scores when processing Rewarded event', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Register with full scores
      db.upsertElectionScore({
        blockNumber: 10274762,
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '9822834105182999',
        sumStake: '40914956818281800',
        sumStakeSquared: '249348803003456830000000000000000',
        status: 'registered',
        eraId: 1982,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Rewarded event has '0' scores (doesn't contain score data)
      const event = createMockElectionScoreEvent({
        eventName: 'Rewarded',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Rewarded', 10274936);

      // Verify scores are NOT overwritten by zeros
      const winner = db.getElectionWinnerByRound(3964);
      expect(winner!.minimalStake).toBe('9822834105182999');
      expect(winner!.sumStake).toBe('40914956818281800');
      expect(winner!.sumStakeSquared).toBe('249348803003456830000000000000000');
    });
  });

  describe('Other Status Events Processing', () => {
    it('should handle Slashed event', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Register first
      db.upsertElectionScore({
        blockNumber: 11000000,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'registered',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      const event = createMockElectionScoreEvent({
        eventName: 'Slashed',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Slashed', 11000100);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('slashed');
      expect(scores[0].minimalStake).toBe('1000000000000'); // Score preserved
    });

    it('should handle Ejected event', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertElectionScore({
        blockNumber: 11000000,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'registered',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      const event = createMockElectionScoreEvent({
        eventName: 'Ejected',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Ejected', 11000100);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('ejected');
    });

    it('should handle Discarded event', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertElectionScore({
        blockNumber: 11000000,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'registered',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      const event = createMockElectionScoreEvent({
        eventName: 'Discarded',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Discarded', 11000100);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('discarded');
    });

    it('should handle Bailed event', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertElectionScore({
        blockNumber: 11000000,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'registered',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      const event = createMockElectionScoreEvent({
        eventName: 'Bailed',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Bailed', 11000100);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('bailed');
    });
  });

  describe('Race Condition Protection', () => {
    it('should not update status once it reaches final state (rewarded)', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Create score with final status
      db.upsertElectionScore({
        blockNumber: 10274936,
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '9822834105182999',
        sumStake: '40914956818281800',
        sumStakeSquared: '249348803003456830000000000000000',
        status: 'rewarded',
        eraId: 1982,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Try to update with Slashed event (should be ignored)
      const event = createMockElectionScoreEvent({
        eventName: 'Slashed',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Slashed', 10274937);

      // Status should still be 'rewarded'
      const winner = db.getElectionWinnerByRound(3964);
      expect(winner!.status).toBe('rewarded');
    });

    it('should not update status once it reaches final state (slashed)', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertElectionScore({
        blockNumber: 11000100,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'slashed',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      // Try to update with Rewarded event (should be ignored)
      const event = createMockElectionScoreEvent({
        eventName: 'Rewarded',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Rewarded', 11000200);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('slashed');
    });

    it('should allow updating from registered to any final status', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertElectionScore({
        blockNumber: 11000000,
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        minimalStake: '1000000000000',
        sumStake: '5000000000000',
        sumStakeSquared: '10000000000000000',
        status: 'registered',
        eraId: 2000,
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 2000 } }));

      // Update to discarded
      const event = createMockElectionScoreEvent({
        eventName: 'Discarded',
        round: 4000,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Discarded', 11000100);

      const scores = db.getElectionScoresByRound(4000);
      expect(scores[0].status).toBe('discarded');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing round gracefully', async () => {
      const event = {
        section: 'multiBlockElectionSigned',
        method: 'Registered',
        data: {
          // round is completely missing (undefined), not null
          submitter: { toString: () => '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr' },
        },
      };

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Should not throw
      await expect(
        (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762)
      ).resolves.not.toThrow();

      // Should log warning about missing round
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          blockNumber: 10274762,
          eventType: 'MultiBlockElectionSigned.Registered',
          round: null,
          submitter: null,
        }),
        'Missing round or submitter'
      );
    });

    it('should handle missing submitter gracefully', async () => {
      const event = {
        section: 'multiBlockElectionSigned',
        method: 'Registered',
        data: {
          round: { toNumber: () => 3964 },
          submitter: null, // Missing!
        },
      };

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      await expect(
        (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762)
      ).resolves.not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle activeEra query failure gracefully', async () => {
      // Mock API failure
      mockApiAH.at.mockRejectedValue(new Error('RPC connection failed'));

      const event = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        score: {
          minimalStake: '9822834105182999',
          sumStake: '40914956818281800',
          sumStakeSquared: '249348803003456830000000000000000',
        },
      });

      // Should not throw despite API error
      await expect(
        (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762)
      ).resolves.not.toThrow();

      // Should log error
      expect(mockLogger.error).toHaveBeenCalled();

      // Score should still be created with null eraId
      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(1);
      expect(scores[0].eraId).toBeNull();
    });

    it('should ignore unknown event types', async () => {
      const event = createMockElectionScoreEvent({
        eventName: 'UnknownEvent',
        round: 3964,
        submitter: '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.UnknownEvent', 10274762);

      // Should not create any scores
      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(0);
    });
  });

  describe('Multiple Submissions Per Round', () => {
    it('should handle multiple submissions for same round', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      // Register multiple submissions
      const submitters = [
        '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr',
        '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      ];

      for (let i = 0; i < submitters.length; i++) {
        const event = createMockElectionScoreEvent({
          eventName: 'Registered',
          round: 3964,
          submitter: submitters[i],
          score: {
            minimalStake: `${1000000000000 + i}`,
            sumStake: `${5000000000000 + i}`,
            sumStakeSquared: `${10000000000000000 + i}`,
          },
        });

        await (indexer as any).handleElectionScoreEvent(event, 'MultiBlockElectionSigned.Registered', 10274762 + i);
      }

      // Should have 3 distinct submissions
      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(3);

      // Verify each submission is unique
      const addresses = scores.map(s => s.submitter);
      expect(new Set(addresses).size).toBe(3);
    });

    it('should allow overwriting same submitter for same round before final status', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      const submitter = '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr';

      // First submission
      const event1 = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter,
        score: {
          minimalStake: '1000000000000',
          sumStake: '5000000000000',
          sumStakeSquared: '10000000000000000',
        },
      });

      await (indexer as any).handleElectionScoreEvent(event1, 'MultiBlockElectionSigned.Registered', 10274762);

      // Second submission (better score)
      const event2 = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter,
        score: {
          minimalStake: '2000000000000',
          sumStake: '6000000000000',
          sumStakeSquared: '20000000000000000',
        },
      });

      await (indexer as any).handleElectionScoreEvent(event2, 'MultiBlockElectionSigned.Registered', 10274763);

      // Should only have 1 submission (overwritten)
      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(1);
      expect(scores[0].minimalStake).toBe('2000000000000'); // New score
    });
  });

  describe('Data Integrity', () => {
    it('should preserve all data fields through status transitions', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      mockApiAH.at.mockResolvedValue(createMockApiAt({ activeEra: { index: 1982 } }));

      const submitter = '13UVJyLnbVp77Z2t6rE2m6rhp6XJPvh5aSpkdNPmWpX45Dnr';

      // Register with full data
      const registerEvent = createMockElectionScoreEvent({
        eventName: 'Registered',
        round: 3964,
        submitter,
        score: {
          minimalStake: '9822834105182999',
          sumStake: '40914956818281800',
          sumStakeSquared: '249348803003456830000000000000000',
        },
      });

      await (indexer as any).handleElectionScoreEvent(registerEvent, 'MultiBlockElectionSigned.Registered', 10274762);

      // Update to rewarded
      const rewardedEvent = createMockElectionScoreEvent({
        eventName: 'Rewarded',
        round: 3964,
        submitter,
      });

      await (indexer as any).handleElectionScoreEvent(rewardedEvent, 'MultiBlockElectionSigned.Rewarded', 10274936);

      // Verify all original data is preserved
      const winner = db.getElectionWinnerByRound(3964);
      expect(winner!.round).toBe(3964);
      expect(winner!.submitter).toBe(submitter);
      expect(winner!.minimalStake).toBe('9822834105182999');
      expect(winner!.sumStake).toBe('40914956818281800');
      expect(winner!.sumStakeSquared).toBe('249348803003456830000000000000000');
      expect(winner!.status).toBe('rewarded');
      expect(winner!.eraId).toBe(1982);
      expect(winner!.blockNumber).toBe(10274936); // Updated to rewarded block
    });
  });
});

describe('Election Score Database Operations', () => {
  let db: StakingDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('getAllElectionWinners', () => {
    it('should return only rewarded submissions', () => {
      // Create era
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Insert various statuses
      const statuses = ['registered', 'rewarded', 'slashed', 'ejected', 'discarded'];
      for (let i = 0; i < statuses.length; i++) {
        db.upsertElectionScore({
          blockNumber: 10274762 + i,
          round: 3964 + i,
          submitter: `Submitter${i}`,
          minimalStake: '1000000000000',
          sumStake: '5000000000000',
          sumStakeSquared: '10000000000000000',
          status: statuses[i],
          eraId: 1982,
        });
      }

      // Should only return rewarded
      const winners = db.getAllElectionWinners(100);
      expect(winners.length).toBe(1);
      expect(winners[0].status).toBe('rewarded');
    });

    it('should respect limit parameter', () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Insert 10 winners
      for (let i = 0; i < 10; i++) {
        db.upsertElectionScore({
          blockNumber: 10274762 + i,
          round: 3964 + i,
          submitter: `Submitter${i}`,
          minimalStake: '1000000000000',
          sumStake: '5000000000000',
          sumStakeSquared: '10000000000000000',
          status: 'rewarded',
          eraId: 1982,
        });
      }

      const winners = db.getAllElectionWinners(5);
      expect(winners.length).toBe(5);
    });
  });

  describe('getElectionScoresByRound', () => {
    it('should return all submissions for a round', () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Insert multiple submissions
      for (let i = 0; i < 5; i++) {
        db.upsertElectionScore({
          blockNumber: 10274762 + i,
          round: 3964,
          submitter: `Submitter${i}`,
          minimalStake: '1000000000000',
          sumStake: '5000000000000',
          sumStakeSquared: '10000000000000000',
          status: i === 0 ? 'rewarded' : 'registered',
          eraId: 1982,
        });
      }

      const scores = db.getElectionScoresByRound(3964);
      expect(scores.length).toBe(5);
    });
  });

  describe('getElectionSubmissionCount', () => {
    it('should count all submissions for a round', () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      for (let i = 0; i < 7; i++) {
        db.upsertElectionScore({
          blockNumber: 10274762 + i,
          round: 3964,
          submitter: `Submitter${i}`,
          minimalStake: '1000000000000',
          sumStake: '5000000000000',
          sumStakeSquared: '10000000000000000',
          status: 'registered',
          eraId: 1982,
        });
      }

      const count = db.getElectionSubmissionCount(3964);
      expect(count).toBe(7);
    });
  });
});
