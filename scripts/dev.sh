#!/bin/bash

# Development startup script
# This ensures services start in the correct order

set -e

echo "🚀 Starting Staking Command Center..."
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "✅ .env created. Please edit it if needed."
fi

# Check if data directory exists
if [ ! -d "data" ]; then
    echo "Creating data directory..."
    mkdir -p data
    echo "✅ data directory created"
fi

# Check if logs directory exists
if [ ! -d "logs" ]; then
    echo "Creating logs directory..."
    mkdir -p logs
    echo "✅ logs directory created"
fi

# Source environment
export $(grep -v '^#' .env | xargs)

echo ""
echo "📊 Configuration:"
echo "  Chain: $CHAIN"
echo "  Database: $DB_PATH"
echo "  API Port: $API_PORT"
echo ""

# Start indexer first in background
echo "1️⃣  Starting Indexer..."
npm run dev --workspace=@staking-cc/indexer > logs/indexer.log 2>&1 &
INDEXER_PID=$!
echo "   Indexer PID: $INDEXER_PID"

# Wait a few seconds for indexer to initialize
echo "   Waiting for indexer to initialize (10s)..."
sleep 10

# Start API server
echo ""
echo "2️⃣  Starting API Server..."
npm run dev --workspace=@staking-cc/api > logs/api.log 2>&1 &
API_PID=$!
echo "   API Server PID: $API_PID"

# Wait for API to be ready
echo "   Waiting for API to be ready (5s)..."
sleep 5

# Start frontend
echo ""
echo "3️⃣  Starting Frontend..."
npm run dev --workspace=@staking-cc/frontend &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "✅ All services started!"
echo ""
echo "📍 URLs:"
echo "   Frontend: http://localhost:3000"
echo "   API:      http://localhost:$API_PORT"
echo ""
echo "📋 Process IDs:"
echo "   Indexer:  $INDEXER_PID"
echo "   API:      $API_PID"
echo "   Frontend: $FRONTEND_PID"
echo ""
echo "📁 Logs:"
echo "   Indexer:  logs/indexer.log"
echo "   API:      logs/api.log"
echo ""
echo "To stop all services:"
echo "   kill $INDEXER_PID $API_PID $FRONTEND_PID"
echo ""
echo "Or press Ctrl+C to stop the frontend (you'll need to kill indexer and API manually)"
echo ""

# Wait for frontend (keeps script running)
wait $FRONTEND_PID
