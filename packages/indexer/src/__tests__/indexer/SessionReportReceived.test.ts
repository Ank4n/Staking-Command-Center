/**
 * SessionReportReceived Event Processing Tests
 * Most critical event for era/session creation
 */

import { Indexer } from '../../indexer/Indexer';
import { createTestDatabase } from '../utils/testDatabase';
import { createMockSessionReportReceivedEvent, createMockApiAt } from '../fixtures/events';
import type { StakingDatabase } from '../../database/Database';
import type { ApiPromise } from '@polkadot/api';

describe('SessionReportReceived Event Processing', () => {
  let db: StakingDatabase;
  let indexer: Indexer;
  let mockApiRC: any;
  let mockApiAH: any;
  let mockLogger: any;

  beforeEach(() => {
    db = createTestDatabase();

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(function(this: any) { return this; }),
    };

    // Mock RPC APIs
    mockApiRC = {
      rpc: {
        chain: {
          getBlockHash: jest.fn().mockResolvedValue('0xmockhash'),
          getHeader: jest.fn().mockResolvedValue({ number: { toNumber: () => 1000 } }),
        },
      },
      at: jest.fn(),
    };

    mockApiAH = {
      rpc: {
        chain: {
          getBlockHash: jest.fn().mockResolvedValue('0xmockhash'),
          getHeader: jest.fn().mockResolvedValue({ number: { toNumber: () => 10000000 } }),
        },
      },
      at: jest.fn(),
    };

    indexer = new Indexer(mockApiRC as ApiPromise, mockApiAH as ApiPromise, db, mockLogger, 10);
  });

  afterEach(() => {
    db.close();
  });

  describe('Session End (No Era Start)', () => {
    it('should create/update ending session and create next session', async () => {
      // Setup: Era 1982 already exists
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now() - 86400000,
      });

      // Mock API responses
      const mockApiAtPrevBlock = createMockApiAt({
        activeEra: { index: 1982 },
        currentEra: 1982,
      });
      const mockApiAtCurrentBlock = createMockApiAt({
        activeEra: { index: 1982 },
        currentEra: 1982,
      });

      mockApiAH.at
        .mockResolvedValueOnce(mockApiAtPrevBlock) // n-1 for ending session
        .mockResolvedValueOnce(mockApiAtCurrentBlock); // n for starting session

      // Create event: session 11935 ends (no era start)
      const event = createMockSessionReportReceivedEvent({
        endIndex: 11935,
        validatorPointsCounts: 599,
        activationTimestamp: null,
      });

      // Process event
      await (indexer as any).handleSessionReportReceived(event, 10279000, Date.now());

      // Assertions
      const endingSession = db.getSession(11935);
      expect(endingSession).not.toBeNull();
      expect(endingSession!.blockNumber).toBe(10279000);
      expect(endingSession!.activeEraId).toBe(1982);
      expect(endingSession!.validatorPointsTotal).toBe(599);

      const nextSession = db.getSession(11936);
      expect(nextSession).not.toBeNull();
      expect(nextSession!.blockNumber).toBeNull(); // Future session
      expect(nextSession!.activeEraId).toBe(1982);
    });
  });

  describe('Era Start (With Activation Timestamp)', () => {
    it('should create new era and update previous era end', async () => {
      // Setup: Era 1982 already exists
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now() - 86400000,
      });

      // Mock API responses
      const mockApiAtPrevBlock = createMockApiAt({
        activeEra: { index: 1982 },
        currentEra: 1983,
      });
      const mockApiAtCurrentBlock = createMockApiAt({
        activeEra: { index: 1983 },
        currentEra: 1983,
      });

      mockApiAH.at
        .mockResolvedValueOnce(mockApiAtPrevBlock) // n-1 for ending session
        .mockResolvedValueOnce(mockApiAtCurrentBlock); // n for starting session

      // Create event: session 11936 ends AND era 1983 starts
      const event = createMockSessionReportReceivedEvent({
        endIndex: 11936,
        validatorPointsCounts: 599,
        activationTimestamp: {
          timestamp: 1762400172000,
          eraId: 1983,
        },
      });

      // Process event
      await (indexer as any).handleSessionReportReceived(event, 10279301, 1762400172000);

      // Assertions: Previous era should be closed
      const era1982 = db.getEra(1982);
      expect(era1982!.sessionEnd).toBe(11936);

      // Assertions: New era should be created
      const era1983 = db.getEra(1983);
      expect(era1983).not.toBeNull();
      expect(era1983!.eraId).toBe(1983);
      expect(era1983!.sessionStart).toBe(11937);
      expect(era1983!.sessionEnd).toBeNull(); // Active era
      expect(era1983!.startTime).toBe(1762400172000);

      // Assertions: Ending session should be created
      const endingSession = db.getSession(11936);
      expect(endingSession).not.toBeNull();
      expect(endingSession!.activeEraId).toBe(1982);

      // Assertions: Starting session should be created
      const startingSession = db.getSession(11937);
      expect(startingSession).not.toBeNull();
      expect(startingSession!.blockNumber).toBeNull(); // Future session
      expect(startingSession!.activeEraId).toBe(1983);
    });

    it('should handle first era creation (no previous era)', async () => {
      // Mock API responses
      const mockApiAtPrevBlock = createMockApiAt({
        activeEra: { index: 1 },
        currentEra: 2,
      });
      const mockApiAtCurrentBlock = createMockApiAt({
        activeEra: { index: 2 },
        currentEra: 2,
      });

      mockApiAH.at
        .mockResolvedValueOnce(mockApiAtPrevBlock)
        .mockResolvedValueOnce(mockApiAtCurrentBlock);

      // Create event: era 2 starts (first tracked era)
      const event = createMockSessionReportReceivedEvent({
        endIndex: 11,
        validatorPointsCounts: 600,
        activationTimestamp: {
          timestamp: Date.now(),
          eraId: 2,
        },
      });

      // Process event
      await (indexer as any).handleSessionReportReceived(event, 1000000, Date.now());

      // Assertions: New era should be created
      const era2 = db.getEra(2);
      expect(era2).not.toBeNull();
      expect(era2!.sessionStart).toBe(12);
      expect(era2!.sessionEnd).toBeNull();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing endIndex gracefully', async () => {
      const event = {
        section: 'stakingRcClient',
        method: 'SessionReportReceived',
        data: {
          endIndex: null, // Missing!
          validatorPointsCounts: { toNumber: () => 600 },
          activationTimestamp: { isEmpty: true },
        },
        toJSON: () => ({}),
      };

      // Should not throw
      await expect(
        (indexer as any).handleSessionReportReceived(event, 10000000, Date.now())
      ).resolves.not.toThrow();

      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle API query failures gracefully', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Mock API to fail
      mockApiAH.at.mockRejectedValue(new Error('RPC connection failed'));

      const event = createMockSessionReportReceivedEvent({
        endIndex: 11936,
        validatorPointsCounts: 599,
        activationTimestamp: null,
      });

      // Should not throw
      await expect(
        (indexer as any).handleSessionReportReceived(event, 10279301, Date.now())
      ).resolves.not.toThrow();

      // Should log error
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should prevent session_end < session_start bug', async () => {
      // Setup: Era 1982 exists
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: null,
        startTime: Date.now() - 86400000,
      });

      // Mock API
      const mockApiAtPrevBlock = createMockApiAt({
        activeEra: { index: 1982 },
        currentEra: 1983,
      });
      const mockApiAtCurrentBlock = createMockApiAt({
        activeEra: { index: 1983 },
        currentEra: 1983,
      });

      mockApiAH.at
        .mockResolvedValueOnce(mockApiAtPrevBlock)
        .mockResolvedValueOnce(mockApiAtCurrentBlock);

      // Create event: era 1983 starts
      const event = createMockSessionReportReceivedEvent({
        endIndex: 11936,
        validatorPointsCounts: 599,
        activationTimestamp: {
          timestamp: 1762400172000,
          eraId: 1983,
        },
      });

      await (indexer as any).handleSessionReportReceived(event, 10279301, 1762400172000);

      // Verify era 1983 has correct values
      const era1983 = db.getEra(1983);
      expect(era1983!.sessionStart).toBe(11937);
      expect(era1983!.sessionEnd).toBeNull(); // Must be NULL for active era
      expect(era1983!.sessionStart).toBeGreaterThan(era1983!.sessionEnd ?? 0);
    });
  });
});
