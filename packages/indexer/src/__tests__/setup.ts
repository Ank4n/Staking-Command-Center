/**
 * Global test setup
 * Runs once before all tests
 */

// Extend Jest matchers if needed
// import '@testing-library/jest-dom';

// Set longer timeout for blockchain tests (some RPC calls can be slow)
jest.setTimeout(30000);

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// Clean up after all tests
afterAll(async () => {
  // Close any open connections, etc.
});
