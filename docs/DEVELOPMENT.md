# Development Guide

## Prerequisites

- Node.js >= 18
- npm >= 9
- (Optional) Docker for containerized deployment

## Project Structure

```
staking-command-center/
├── config/              # RPC endpoint configurations
├── docs/                # Documentation
├── packages/
│   ├── indexer/        # Block listener and event processor
│   ├── api/            # REST API and WebSocket server
│   └── frontend/       # React dashboard
├── shared/             # Shared TypeScript types
└── docker-compose.yml  # Docker orchestration
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env`:
```
CHAIN=polkadot  # or kusama
DB_PATH=./data/staking.db
MAX_ERAS=100
LOG_LEVEL=info
API_PORT=4000
```

### 3. Build All Packages

```bash
npm run build
```

## Running in Development Mode

### Option A: Run All Services (Recommended)

```bash
npm run dev
```

This will start:
- Indexer (listening to blocks)
- API Server (REST + WebSocket)
- Frontend (Vite dev server)

### Option B: Run Services Individually

In separate terminals:

```bash
# Terminal 1: Indexer
npm run dev --workspace=@staking-cc/indexer

# Terminal 2: API Server
npm run dev --workspace=@staking-cc/api

# Terminal 3: Frontend
npm run dev --workspace=@staking-cc/frontend
```

### Frontend will be available at:
- http://localhost:3000

### API will be available at:
- http://localhost:4000

## Package Details

### Indexer (`packages/indexer`)

The indexer connects to Polkadot/Kusama RPC nodes and:
- Listens to finalized blocks
- Processes staking-related events
- Stores data in SQLite database
- Implements automatic RPC failover

**Key files:**
- `src/rpc/RpcManager.ts` - RPC connection with failover
- `src/processors/EventProcessor.ts` - Event handling logic
- `src/indexer/Indexer.ts` - Main block listener
- `src/database/Database.ts` - SQLite operations

### API Server (`packages/api`)

REST API and WebSocket server that:
- Provides endpoints for querying indexed data
- Broadcasts real-time updates via WebSocket
- Serves the frontend in production

**Key files:**
- `src/routes/index.ts` - REST API endpoints
- `src/websocket/WebSocketManager.ts` - WebSocket handler
- `src/database/DatabaseClient.ts` - Read-only database client

**API Endpoints:**
- `GET /api/status` - Current chain status
- `GET /api/eras` - List of eras
- `GET /api/eras/:eraIndex` - Era details
- `GET /api/warnings` - Recent warnings
- `GET /api/sessions/:sessionIndex` - Session details
- `GET /api/election/current` - Current election phase

### Frontend (`packages/frontend`)

React dashboard that displays:
- Real-time status (era, session, validators)
- Era history with inflation data
- System warnings and anomalies
- Live updates via WebSocket

## Database Schema

The indexer creates a SQLite database with these tables:

- `eras` - Era information
- `sessions` - Session details
- `election_phases` - Election phase transitions
- `validator_points` - Validator performance
- `warnings` - System anomalies
- `events` - Raw blockchain events
- `indexer_state` - Sync progress

## Development Tips

### Hot Reload

All packages support hot reload in development:
- Indexer: Uses `tsx watch`
- API: Uses `tsx watch`
- Frontend: Uses Vite HMR

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Database Inspection

You can inspect the SQLite database using:

```bash
sqlite3 ./data/staking.db
```

Useful queries:
```sql
-- Latest era
SELECT * FROM eras ORDER BY era_index DESC LIMIT 1;

-- Recent warnings
SELECT * FROM warnings ORDER BY timestamp DESC LIMIT 10;

-- Database stats
SELECT
  (SELECT COUNT(*) FROM eras) as eras,
  (SELECT COUNT(*) FROM sessions) as sessions,
  (SELECT COUNT(*) FROM warnings) as warnings;
```

### Troubleshooting

**Indexer not connecting:**
- Check RPC endpoints in `config/rpc-endpoints.json`
- Try setting `CUSTOM_RPC_ENDPOINT` in `.env`
- Check logs for connection errors

**API returning 500 errors:**
- Ensure indexer has run and created the database
- Check database file exists at `DB_PATH`
- Review API logs for specific errors

**Frontend not updating:**
- Check WebSocket connection in browser console
- Verify API server is running
- Check CORS settings if accessing from different domain

## Testing

Currently, the project focuses on integration testing. To test:

1. Start all services in development mode
2. Monitor indexer logs for block processing
3. Check API responses using curl or Postman
4. Verify frontend displays data correctly

Example API test:
```bash
curl http://localhost:4000/api/status
```

## Performance Considerations

- **Database size**: ~100-150MB per 100 eras
- **RPC calls**: Minimized through caching and incremental updates
- **Memory usage**: ~200-300MB per service
- **Block processing**: 2-5 seconds per block on average

## Next Steps

- Add unit tests for core functionality
- Implement additional warning types
- Add reward claim tracking
- Create admin panel for configuration
- Add Prometheus metrics export
