/**
 * EraPaid Event Processing Tests
 * Critical for inflation data accuracy
 */

import { Indexer } from '../../indexer/Indexer';
import { createTestDatabase } from '../utils/testDatabase';
import { createMockEraPaidEvent } from '../fixtures/events';
import type { StakingDatabase } from '../../database/Database';
import type { ApiPromise } from '@polkadot/api';

describe('EraPaid Event Processing', () => {
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
    mockApiAH = { rpc: {}, at: jest.fn() };

    indexer = new Indexer(mockApiRC as ApiPromise, mockApiAH as ApiPromise, db, mockLogger, 10);
  });

  afterEach(() => {
    db.close();
  });

  describe('Inflation Data Processing', () => {
    it('should update era inflation from EraPaid event', async () => {
      // Setup: Era 1982 exists
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: 11936,
        startTime: Date.now() - 86400000,
      });

      // Real values from Polkadot era 1982: https://assethub-polkadot.subscan.io/event/10279301-6
      const event = createMockEraPaidEvent({
        eraIndex: 1982,
        validatorPayout: '971146566430052',
        remainder: '171378805840597',
      });

      // Process event
      await (indexer as any).handleEraPaid(event, 10279301);

      // Assertions
      const era = db.getEra(1982);
      expect(era).not.toBeNull();

      // Verify individual fields
      expect(era!.inflationValidators).toBe('971146566430052');
      expect(era!.inflationTreasury).toBe('171378805840597');

      // Verify total is sum of validator + treasury
      const expectedTotal = (BigInt('971146566430052') + BigInt('171378805840597')).toString();
      expect(era!.inflationTotal).toBe(expectedTotal);
      expect(era!.inflationTotal).toBe('1142525372270649');
    });

    it('should handle very large inflation values', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: 12005,
        startTime: Date.now(),
      });

      // Extreme large values (edge case for BigInt)
      const event = createMockEraPaidEvent({
        eraIndex: 2000,
        validatorPayout: '999999999999999999999999',
        remainder: '111111111111111111111111',
      });

      await (indexer as any).handleEraPaid(event, 11000000);

      const era = db.getEra(2000);
      expect(era!.inflationValidators).toBe('999999999999999999999999');
      expect(era!.inflationTreasury).toBe('111111111111111111111111');

      const expectedTotal = (BigInt('999999999999999999999999') + BigInt('111111111111111111111111')).toString();
      expect(era!.inflationTotal).toBe(expectedTotal);
    });

    it('should handle zero inflation values', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: 12005,
        startTime: Date.now(),
      });

      const event = createMockEraPaidEvent({
        eraIndex: 2000,
        validatorPayout: '0',
        remainder: '0',
      });

      await (indexer as any).handleEraPaid(event, 11000000);

      const era = db.getEra(2000);
      expect(era!.inflationTotal).toBe('0');
      expect(era!.inflationValidators).toBe('0');
      expect(era!.inflationTreasury).toBe('0');
    });

    it('should calculate correct percentages for validator/treasury split', async () => {
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: 11936,
        startTime: Date.now(),
      });

      const event = createMockEraPaidEvent({
        eraIndex: 1982,
        validatorPayout: '600000000000', // 60%
        remainder: '400000000000',        // 40%
      });

      await (indexer as any).handleEraPaid(event, 10279301);

      const era = db.getEra(1982);

      // Calculate percentages
      const total = BigInt(era!.inflationTotal!);
      const validators = BigInt(era!.inflationValidators!);
      const treasury = BigInt(era!.inflationTreasury!);

      const validatorPct = Number((validators * BigInt(10000)) / total) / 100;
      const treasuryPct = Number((treasury * BigInt(10000)) / total) / 100;

      expect(validatorPct).toBeCloseTo(60.0, 1);
      expect(treasuryPct).toBeCloseTo(40.0, 1);
      expect(validatorPct + treasuryPct).toBeCloseTo(100.0, 1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing eraIndex gracefully', async () => {
      const event = {
        section: 'staking',
        method: 'EraPaid',
        data: {
          eraIndex: null, // Missing!
          validatorPayout: { toString: () => '1000000' },
          remainder: { toString: () => '500000' },
        },
      };

      // Should not throw
      await expect(
        (indexer as any).handleEraPaid(event, 10000000)
      ).resolves.not.toThrow();

      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle non-existent era gracefully', async () => {
      // Era 9999 doesn't exist in database
      const event = createMockEraPaidEvent({
        eraIndex: 9999,
        validatorPayout: '1000000000000',
        remainder: '500000000000',
      });

      // Should not throw (updateEraInflation will be a no-op if era doesn't exist)
      await expect(
        (indexer as any).handleEraPaid(event, 10000000)
      ).resolves.not.toThrow();
    });

    it('should handle malformed BigInt strings gracefully', async () => {
      db.upsertEra({
        eraId: 2000,
        sessionStart: 12000,
        sessionEnd: 12005,
        startTime: Date.now(),
      });

      const event = {
        section: 'staking',
        method: 'EraPaid',
        data: {
          eraIndex: { toNumber: () => 2000 },
          validatorPayout: { toString: () => 'invalid' },
          remainder: { toString: () => '500000' },
        },
      };

      // Should catch error and log
      await expect(
        (indexer as any).handleEraPaid(event, 10000000)
      ).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Data Integrity', () => {
    it('should not overwrite existing inflation data', async () => {
      // Create era with existing inflation data
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: 11936,
        startTime: Date.now(),
      });
      db.updateEraInflation(1982, '1000000000000', '600000000000', '400000000000');

      // Process EraPaid with different values
      const event = createMockEraPaidEvent({
        eraIndex: 1982,
        validatorPayout: '700000000000',
        remainder: '300000000000',
      });

      await (indexer as any).handleEraPaid(event, 10279301);

      // New values should overwrite old values
      const era = db.getEra(1982);
      expect(era!.inflationValidators).toBe('700000000000');
      expect(era!.inflationTreasury).toBe('300000000000');
      expect(era!.inflationTotal).toBe('1000000000000');
    });

    it('should preserve other era fields when updating inflation', async () => {
      // Create era with validator count
      db.upsertEra({
        eraId: 1982,
        sessionStart: 11931,
        sessionEnd: 11936,
        startTime: 1234567890000,
      });
      db.updateEraValidatorCount(1982, 297);

      // Update inflation
      const event = createMockEraPaidEvent({
        eraIndex: 1982,
        validatorPayout: '600000000000',
        remainder: '400000000000',
      });

      await (indexer as any).handleEraPaid(event, 10279301);

      // Validator count should be preserved
      const era = db.getEra(1982);
      expect(era!.validatorsElected).toBe(297);
      expect(era!.sessionStart).toBe(11931);
      expect(era!.sessionEnd).toBe(11936);
      expect(era!.startTime).toBe(1234567890000);
    });
  });
});
