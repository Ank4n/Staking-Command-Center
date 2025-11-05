#!/bin/bash

# Helper script to start development with correct Node.js version
# This ensures Node 18 is used (required for better-sqlite3 compatibility)

echo "Starting Staking Command Center with Node 18..."

# Source nvm and use Node 18
source ~/.nvm/nvm.sh
nvm use 18

# Verify Node version
echo "Using Node version: $(node --version)"

# Start the development environment
npm run dev:ordered
