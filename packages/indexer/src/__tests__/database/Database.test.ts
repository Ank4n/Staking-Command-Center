/**
 * Database upsert operation tests
 * Critical for ensuring data integrity during event processing
 */

import { createTestDatabase, seedTestDatabase, assertDatabaseState } from '../utils/testDatabase';
import type { StakingDatabase } from '../../database/Database';

describe('Database - Era Upsert Operations', () => {
  let db: StakingDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertEra', () => {
    it('should create a new era', () => {
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      const era = db.getEra(1000);
      expect(era).not.toBeNull();
      expect(era!.eraId).toBe(1000);
      expect(era!.sessionStart).toBe(6000);
      expect(era!.sessionEnd).toBeNull();
    });

    it('should update session_end when era completes', () => {
      // Create active era
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Complete the era
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: 6005,
        startTime: Date.now(),
      });

      const era = db.getEra(1000);
      expect(era!.sessionEnd).toBe(6005);
    });

    it('should allow setting session_end back to NULL', () => {
      // Create era with session_end set (wrong state)
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: 6005,
        startTime: Date.now(),
      });

      // Fix: set session_end back to NULL for active era
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      const era = db.getEra(1000);
      expect(era!.sessionEnd).toBeNull();
    });

    it('should preserve inflation data when updating era', () => {
      // Create era
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Add inflation data
      db.updateEraInflation(1000, '1000000000000', '600000000000', '400000000000');

      // Update session_end (should preserve inflation)
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: 6005,
        startTime: Date.now(),
      });

      const era = db.getEra(1000);
      expect(era!.inflationTotal).toBe('1000000000000');
      expect(era!.inflationValidators).toBe('600000000000');
      expect(era!.inflationTreasury).toBe('400000000000');
    });
  });

  describe('updateEraInflation', () => {
    it('should update inflation data for existing era', () => {
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.updateEraInflation(1000, '1142525372270649', '971146566430052', '171378805840597');

      const era = db.getEra(1000);
      expect(era!.inflationTotal).toBe('1142525372270649');
      expect(era!.inflationValidators).toBe('971146566430052');
      expect(era!.inflationTreasury).toBe('171378805840597');
    });

    it('should handle very large BigInt values', () => {
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      const largeValue = '999999999999999999999999999';
      db.updateEraInflation(1000, largeValue, largeValue, largeValue);

      const era = db.getEra(1000);
      expect(era!.inflationTotal).toBe(largeValue);
    });
  });

  describe('updateEraValidatorCount', () => {
    it('should update validator count for existing era', () => {
      db.upsertEra({
        eraId: 1000,
        sessionStart: 6000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.updateEraValidatorCount(1000, 297);

      const era = db.getEra(1000);
      expect(era!.validatorsElected).toBe(297);
    });
  });
});

describe('Database - Session Upsert Operations', () => {
  let db: StakingDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertSession', () => {
    it('should create a new session', () => {
      // Create era first (foreign key constraint)
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      db.upsertSession({
        sessionId: 12000,
        blockNumber: null, // Use null to avoid block FK constraint
        activationTimestamp: Date.now(),
        activeEraId: 2000,
        plannedEraId: 2000,
        validatorPointsTotal: 650,
      });

      const session = db.getSession(12000);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(12000);
      expect(session!.activeEraId).toBe(2000);
    });

    it('should update existing session with new data', () => {
      // Create era first (foreign key constraint)
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });

      // Create session without block number (future session)
      db.upsertSession({
        sessionId: 12000,
        blockNumber: null,
        activationTimestamp: null,
        activeEraId: 2000,
        plannedEraId: 2000,
        validatorPointsTotal: 0,
      });

      // Update when session completes
      db.upsertSession({
        sessionId: 12000,
        blockNumber: null, // Use null to avoid block FK constraint
        activationTimestamp: null,
        activeEraId: 2000,
        plannedEraId: 2000,
        validatorPointsTotal: 650,
      });

      const session = db.getSession(12000);
      expect(session!.blockNumber).toBeNull();
      expect(session!.validatorPointsTotal).toBe(650);
    });

    it('should handle sessions with NULL block numbers', () => {
      // Create eras first (foreign key constraint)
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });
      db.upsertEra({
        eraId: 2001,
        sessionStart: 12006,
        sessionEnd: null,
        startTime: Date.now() + 86400000,
      });

      db.upsertSession({
        sessionId: 12000,
        blockNumber: null,
        activationTimestamp: null,
        activeEraId: 2000,
        plannedEraId: 2001,
        validatorPointsTotal: 0,
      });

      const session = db.getSession(12000);
      expect(session).not.toBeNull();
      expect(session!.blockNumber).toBeNull();
    });

    it('should handle era transitions (plannedEraId > activeEraId)', () => {
      // Create both eras (foreign key constraint)
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: null,
        startTime: Date.now(),
      });
      db.upsertEra({
        eraId: 2001,
        sessionStart: 12006,
        sessionEnd: null,
        startTime: Date.now() + 86400000,
      });

      db.upsertSession({
        sessionId: 12000,
        blockNumber: null, // Use null to avoid block FK constraint
        activationTimestamp: null,
        activeEraId: 2000,
        plannedEraId: 2001, // Election happening
        validatorPointsTotal: 650,
      });

      const session = db.getSession(12000);
      expect(session!.activeEraId).toBe(2000);
      expect(session!.plannedEraId).toBe(2001);
    });
  });
});

describe('Database - Edge Cases and Error Handling', () => {
  let db: StakingDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('should handle querying non-existent era', () => {
    const era = db.getEra(99999);
    expect(era).toBeNull();
  });

  it('should handle querying non-existent session', () => {
    const session = db.getSession(99999);
    expect(session).toBeNull();
  });

  it('should return empty array when no eras exist', () => {
    const eras = db.getRecentEras(10);
    expect(eras).toEqual([]);
  });

  it('should handle concurrent era updates correctly', () => {
    // Simulate race condition: era created twice in quick succession
    db.upsertEra({
      eraId: 1000,
      sessionStart: 6000,
      sessionEnd: null,
      startTime: Date.now(),
    });

    db.upsertEra({
      eraId: 1000,
      sessionStart: 6000,
      sessionEnd: null,
      startTime: Date.now(),
    });

    const eras = db.getRecentEras(10);
    expect(eras.length).toBe(1); // Should not duplicate
  });
});
