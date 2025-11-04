#!/bin/sh
set -e

echo "Starting Staking Command Center"
echo "Chain: ${CHAIN:-unknown}"
echo "Database: ${DB_PATH:-/data/staking.db}"

# Start indexer in background
echo "Starting indexer process..."
node packages/indexer/dist/index.js &
INDEXER_PID=$!

# Wait a moment for indexer to initialize
sleep 2

# Start API server in foreground
echo "Starting API server..."
node packages/api/dist/index.js &
API_PID=$!

# Function to handle shutdown
shutdown() {
  echo "Shutting down gracefully..."
  kill $API_PID 2>/dev/null || true
  kill $INDEXER_PID 2>/dev/null || true
  exit 0
}

# Trap signals
trap shutdown SIGTERM SIGINT

# Wait for processes
wait
