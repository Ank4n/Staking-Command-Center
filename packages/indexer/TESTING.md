# Indexer Testing Guide

## Overview

Comprehensive test suite for the blockchain indexer, focusing on event processing logic and database operations.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- SessionReportReceived.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="Era Upsert"
```

## Test Structure

```
src/__tests__/
├── setup.ts                          # Global test configuration
├── utils/
│   └── testDatabase.ts              # Test database utilities
├── fixtures/
│   └── events.ts                    # Mock event fixtures
├── database/
│   └── Database.test.ts             # Database operation tests
└── indexer/
    ├── SessionReportReceived.test.ts  # Session/Era creation tests
    ├── EraPaid.test.ts                # Inflation data tests
    └── PhaseTransitioned.test.ts      # Election phase tests (TODO)
```

## Test Coverage Goals

| Component | Current | Target |
|-----------|---------|--------|
| Database Operations | ✅ 100% | 100% |
| SessionReportReceived | ✅ 95% | 90% |
| EraPaid | ✅ 100% | 90% |
| PhaseTransitioned | 🚧 0% | 90% |
| Overall | ~65% | 70% |

## Key Test Categories

### 1. Database Upsert Operations

**Why Critical:** Prevents data corruption bugs like era 1983's `session_end < session_start`.

**Tests:**
- ✅ Create new era
- ✅ Update session_end when era completes
- ✅ Allow setting session_end back to NULL (bug fix verification)
- ✅ Preserve inflation data when updating era
- ✅ Handle concurrent updates correctly

**Run:** `npm test -- Database.test.ts`

### 2. SessionReportReceived Event Processing

**Why Critical:** Most important event - creates eras and sessions.

**Tests:**
- ✅ Create/update sessions when session ends (no era start)
- ✅ Create new era and update previous era end (with activation timestamp)
- ✅ Handle first era creation (no previous era)
- ✅ Handle missing endIndex gracefully
- ✅ Handle API query failures gracefully
- ✅ Prevent session_end < session_start bug

**Run:** `npm test -- SessionReportReceived.test.ts`

### 3. EraPaid Event Processing

**Why Critical:** Only source of inflation data - must be accurate.

**Tests:**
- ✅ Update era inflation from EraPaid event
- ✅ Handle very large inflation values (BigInt edge cases)
- ✅ Handle zero inflation values
- ✅ Calculate correct validator/treasury split percentages
- ✅ Handle missing eraIndex gracefully
- ✅ Handle non-existent era gracefully
- ✅ Preserve other era fields when updating inflation

**Run:** `npm test -- EraPaid.test.ts`

## Writing New Tests

### 1. Use Test Database

Always use `createTestDatabase()` for isolated test databases:

```typescript
import { createTestDatabase } from '../utils/testDatabase';

let db: StakingDatabase;

beforeEach(() => {
  db = createTestDatabase(); // Fresh DB for each test
});

afterEach(() => {
  db.close();
});
```

### 2. Use Mock Fixtures

Use pre-built mock events from `fixtures/events.ts`:

```typescript
import { createMockSessionReportReceivedEvent } from '../fixtures/events';

const event = createMockSessionReportReceivedEvent({
  endIndex: 11936,
  validatorPointsCounts: 599,
  activationTimestamp: {
    timestamp: 1762400172000,
    eraId: 1983,
  },
});
```

### 3. Test Both Happy Path and Edge Cases

```typescript
describe('Feature Name', () => {
  describe('Happy Path', () => {
    it('should handle normal case', () => {
      // Test expected behavior
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing data', () => {
      // Test error handling
    });

    it('should handle extreme values', () => {
      // Test boundary conditions
    });
  });
});
```

### 4. Use Descriptive Test Names

**Good:**
```typescript
it('should create new era and update previous era end when activation timestamp present', ...)
```

**Bad:**
```typescript
it('should work', ...)
```

## Common Test Patterns

### Testing Event Processing

```typescript
// 1. Setup database state
db.upsertEra({ eraId: 1982, ... });

// 2. Mock API responses
mockApiAH.at.mockResolvedValue(createMockApiAt({
  activeEra: { index: 1982 },
  currentEra: 1983,
}));

// 3. Create mock event
const event = createMockSessionReportReceivedEvent({ ... });

// 4. Process event
await (indexer as any).handleSessionReportReceived(event, blockNumber, timestamp);

// 5. Assert database state
const era = db.getEra(1983);
expect(era!.sessionStart).toBe(11937);
expect(era!.sessionEnd).toBeNull();
```

### Testing Error Handling

```typescript
it('should handle API failures gracefully', async () => {
  // Mock API to fail
  mockApiAH.at.mockRejectedValue(new Error('RPC connection failed'));

  // Should not throw
  await expect(
    processEvent(...)
  ).resolves.not.toThrow();

  // Should log error
  expect(mockLogger.error).toHaveBeenCalled();
});
```

## Debugging Tests

### Run Single Test

```bash
npm test -- --testNamePattern="should create new era"
```

### Enable Verbose Output

```bash
npm test -- --verbose
```

### Debug in VSCode

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-coverage"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## CI/CD Integration

Tests run automatically on:
- ✅ Pull requests
- ✅ Pre-commit hooks (optional)
- ✅ Main branch pushes

**Minimum Requirements:**
- All tests must pass
- Coverage must be ≥70%
- No console errors or warnings

## Best Practices

1. **Isolation**: Each test should be independent
2. **Speed**: Keep tests fast (<100ms each)
3. **Clarity**: Test names should describe expected behavior
4. **Coverage**: Test happy path + edge cases + error handling
5. **Deterministic**: Tests should never be flaky

## Real-World Test Data

Tests use real values from actual blockchain events:

**Era 1982 EraPaid:**
```typescript
// From: https://assethub-polkadot.subscan.io/event/10279301-6
validatorPayout: '971146566430052',
remainder: '171378805840597',
total: '1142525372270649'
```

## Troubleshooting

### Tests Failing After Code Changes

1. Check if test expectations need updating
2. Verify mock data matches new event structure
3. Check database schema changes

### Coverage Dropping

```bash
# See which lines aren't covered
npm run test:coverage
open coverage/lcov-report/index.html
```

### Flaky Tests

- Check for timing issues (use proper async/await)
- Verify test isolation (no shared state)
- Check for random data (use seeded random)

## Future Test Additions

- [ ] PhaseTransitioned event processing tests
- [ ] Integration tests with real RPC endpoints (testnet)
- [ ] Performance tests (can handle 1000 blocks/sec?)
- [ ] Stress tests (database corruption under load)
- [ ] End-to-end tests (full indexer lifecycle)

## Questions?

See:
- Jest docs: https://jestjs.io/docs/getting-started
- Testing best practices: https://testingjavascript.com/
