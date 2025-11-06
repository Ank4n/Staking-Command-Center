/**
 * Test database utilities
 * Creates in-memory SQLite databases for testing
 */

import { StakingDatabase } from '../../database/Database';
import type { Logger } from 'pino';

/**
 * Create an in-memory test database
 * Each test gets a fresh isolated database
 */
export function createTestDatabase(): StakingDatabase {
  // Create mock logger that doesn't output during tests
  const mockLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => mockLogger),
    level: 'silent',
    silent: jest.fn(),
  } as any;

  // Use :memory: path for in-memory database (not persisted to disk)
  return new StakingDatabase(':memory:', mockLogger, 100);
}

/**
 * Seed test database with sample data
 */
export function seedTestDatabase(db: StakingDatabase, data: {
  eras?: Array<{ eraId: number; sessionStart: number; sessionEnd: number | null; startTime: number }>;
  sessions?: Array<{ sessionId: number; blockNumber: number | null; activeEraId: number | null; plannedEraId: number | null }>;
  blocksAH?: Array<{ blockNumber: number; timestamp: number }>;
  eventsAH?: Array<{ blockNumber: number; eventId: string; eventType: string; data: string }>;
}) {
  // Insert eras
  if (data.eras) {
    for (const era of data.eras) {
      db.upsertEra({
        eraId: era.eraId,
        sessionStart: era.sessionStart,
        sessionEnd: era.sessionEnd,
        startTime: era.startTime,
      });
    }
  }

  // Insert sessions
  if (data.sessions) {
    for (const session of data.sessions) {
      db.upsertSession({
        sessionId: session.sessionId,
        blockNumber: session.blockNumber,
        activationTimestamp: null,
        activeEraId: session.activeEraId,
        plannedEraId: session.plannedEraId,
        validatorPointsTotal: 600,
      });
    }
  }

  // Insert blocks
  if (data.blocksAH) {
    for (const block of data.blocksAH) {
      db.insertBlockAH(block);
    }
  }

  // Insert events
  if (data.eventsAH) {
    for (const event of data.eventsAH) {
      db.insertEventAH(event);
    }
  }

  return db;
}

/**
 * Assert database state matches expected values
 */
export function assertDatabaseState(db: StakingDatabase, assertions: {
  eraCount?: number;
  sessionCount?: number;
  era?: { eraId: number; sessionStart?: number; sessionEnd?: number | null; inflationTotal?: string | null };
}) {
  if (assertions.eraCount !== undefined) {
    const eras = db.getRecentEras(100);
    expect(eras.length).toBe(assertions.eraCount);
  }

  if (assertions.sessionCount !== undefined) {
    // Count all sessions across all eras
    const allEras = db.getRecentEras(100);
    let totalSessions = 0;
    for (const era of allEras) {
      const sessions = db.getSessionsByEra(era.eraId);
      totalSessions += sessions.length;
    }
    expect(totalSessions).toBe(assertions.sessionCount);
  }

  if (assertions.era) {
    const era = db.getEra(assertions.era.eraId);
    expect(era).not.toBeNull();

    if (assertions.era.sessionStart !== undefined) {
      expect(era!.sessionStart).toBe(assertions.era.sessionStart);
    }
    if (assertions.era.sessionEnd !== undefined) {
      expect(era!.sessionEnd).toBe(assertions.era.sessionEnd);
    }
    if (assertions.era.inflationTotal !== undefined) {
      expect(era!.inflationTotal).toBe(assertions.era.inflationTotal);
    }
  }
}
