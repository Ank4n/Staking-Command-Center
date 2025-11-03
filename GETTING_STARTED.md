# Getting Started with Staking Command Center

Welcome! This guide will help you get the Staking Command Center up and running quickly.

## What You Have

A complete TypeScript monorepo with:
- **Indexer**: Monitors blockchain and stores staking data
- **API Server**: Provides REST endpoints and WebSocket updates
- **Frontend**: React dashboard for visualization
- **Docker Setup**: Ready for containerized deployment

## Quick Start (Development)

### 1. Install Dependencies

```bash
npm install
```

This will install all dependencies for all packages.

### 2. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` and set:
```
CHAIN=polkadot
DB_PATH=./data/staking.db
MAX_ERAS=100
LOG_LEVEL=info
API_PORT=4000
```

For Kusama, use `CHAIN=kusama`

### 3. Build All Packages

```bash
npm run build
```

This compiles TypeScript for all packages.

### 4. Create Data Directory

```bash
mkdir -p data
```

### 5. Start Services

**Option A: All at once (recommended for development)**
```bash
npm run dev
```

This starts indexer, API, and frontend in watch mode.

**Option B: Individual services**

In separate terminals:

```bash
# Terminal 1: Indexer
npm run dev --workspace=@staking-cc/indexer

# Terminal 2: API
npm run dev --workspace=@staking-cc/api

# Terminal 3: Frontend
npm run dev --workspace=@staking-cc/frontend
```

### 6. Access the Dashboard

Open your browser to:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000/api/status

## Quick Start (Docker)

The easiest way to run both Polkadot and Kusama instances:

```bash
# Build and start everything
docker-compose up -d

# View logs
docker-compose logs -f polkadot-indexer
docker-compose logs -f kusama-indexer

# Access services
# Polkadot: http://localhost:4000
# Kusama: http://localhost:4001

# Stop everything
docker-compose down
```

## What to Expect

### First Run

When you first start the indexer:

1. **Connection Phase** (~10 seconds)
   - Connects to RPC endpoint
   - Retrieves chain metadata
   - Syncs initial state

2. **Catch-up Phase** (varies)
   - If database is empty, starts from current block
   - Processes recent blocks to build history
   - Shows progress every 100 blocks

3. **Live Monitoring** (ongoing)
   - Subscribes to new finalized blocks
   - Processes events in real-time
   - Updates database continuously

### What You'll See

**Indexer Logs:**
```
[INFO] Starting Staking Command Center Indexer
[INFO] Configuration loaded { chain: 'polkadot' }
[INFO] Database initialized
[INFO] Connecting to RPC endpoint...
[INFO] Connected to RPC { endpoint: 'wss://rpc.polkadot.io' }
[INFO] Indexer started successfully
[INFO] New session started { sessionIndex: 12345 }
[INFO] Block processing progress { blockNumber: 100, eras: 5, sessions: 50 }
```

**API Logs:**
```
[INFO] Starting Staking Command Center API Server
[INFO] Database client initialized
[INFO] WebSocket manager initialized
[INFO] API server listening { port: 4000, host: '0.0.0.0' }
```

**Frontend:**
- Status cards showing current era, session, validators
- Live connection indicator (green = connected)
- Eras table with recent era data
- Warnings panel (empty initially)

## Testing the System

### 1. Check Indexer Status

```bash
# Check if indexer is processing blocks
tail -f indexer.log  # or check docker logs

# Check database
sqlite3 data/polkadot.db "SELECT COUNT(*) FROM eras;"
sqlite3 data/polkadot.db "SELECT * FROM eras ORDER BY era_index DESC LIMIT 1;"
```

### 2. Test API Endpoints

```bash
# Health check
curl http://localhost:4000/api/health

# Current status
curl http://localhost:4000/api/status | jq

# Recent eras
curl http://localhost:4000/api/eras?limit=5 | jq

# Recent warnings
curl http://localhost:4000/api/warnings?limit=10 | jq
```

### 3. Test WebSocket

Open browser console on http://localhost:3000 and check:
- Network tab shows WebSocket connection
- Console shows no errors
- Status cards update when new blocks arrive

## Common Issues

### Port Already in Use

If ports 3000, 4000, or 4001 are already in use:

```bash
# Find what's using the port
lsof -i :4000

# Kill the process
kill -9 <PID>

# Or change ports in .env
API_PORT=5000
```

### RPC Connection Fails

The indexer tries multiple endpoints automatically. If all fail:

1. Check your internet connection
2. Try a custom endpoint:
   ```bash
   CUSTOM_RPC_ENDPOINT=wss://your-endpoint.com
   ```
3. Check firewall/proxy settings

### Database Locked

If you see "database is locked":

1. Ensure only one indexer is running per chain
2. Stop all services: `docker-compose down`
3. Remove lock files: `rm data/*.db-shm data/*.db-wal`
4. Restart services

### Frontend Not Updating

1. Check browser console for errors
2. Verify API is running: `curl http://localhost:4000/api/status`
3. Check WebSocket connection in Network tab
4. Hard refresh (Cmd+Shift+R or Ctrl+Shift+R)

## Next Steps

### For Development

1. **Explore the Code**
   - `packages/indexer/src/` - Block processing logic
   - `packages/api/src/routes/` - API endpoints
   - `packages/frontend/src/` - React components

2. **Review Documentation**
   - [DEVELOPMENT.md](./docs/DEVELOPMENT.md) - Detailed dev guide
   - [tracking-requirements.md](./docs/tracking-requirements.md) - What we track

3. **Make Changes**
   - Hot reload works in dev mode
   - Edit code and see changes immediately
   - Run `npm run typecheck` to verify types

### For Production

1. **Choose Deployment Method**
   - Docker Compose (easy self-hosting)
   - Fly.io (recommended cloud)
   - Manual PM2 deployment

2. **Review Deployment Guide**
   - [DEPLOYMENT.md](./docs/DEPLOYMENT.md)

3. **Configure for Production**
   - Set appropriate `LOG_LEVEL=warn`
   - Configure reverse proxy (nginx/caddy)
   - Set up monitoring/alerts

## Project Structure

```
staking-command-center/
├── packages/
│   ├── indexer/          # Block listener
│   │   ├── src/
│   │   │   ├── rpc/      # RPC connection with failover
│   │   │   ├── database/ # SQLite operations
│   │   │   ├── processors/ # Event processing
│   │   │   ├── indexer/  # Main indexer
│   │   │   └── index.ts  # Entry point
│   │   └── package.json
│   │
│   ├── api/              # REST + WebSocket server
│   │   ├── src/
│   │   │   ├── routes/   # API endpoints
│   │   │   ├── websocket/ # WebSocket handler
│   │   │   ├── database/ # DB client
│   │   │   └── index.ts  # Entry point
│   │   └── package.json
│   │
│   └── frontend/         # React dashboard
│       ├── src/
│       │   ├── components/ # UI components
│       │   ├── hooks/     # React hooks
│       │   └── App.tsx    # Main app
│       └── package.json
│
├── shared/               # Shared types
├── config/               # RPC endpoints
├── docs/                 # Documentation
├── docker-compose.yml    # Docker setup
└── .env                  # Configuration
```

## Key Files

- `config/rpc-endpoints.json` - RPC endpoint pools
- `.env` - Environment configuration
- `CLAUDE.md` - Implementation plan and architecture
- `README.md` - Overview and quick reference

## Get Help

If you run into issues:

1. Check logs for error messages
2. Review troubleshooting section above
3. Check [DEVELOPMENT.md](./docs/DEVELOPMENT.md)
4. Open an issue with:
   - What you're trying to do
   - What happened
   - Error messages
   - Your environment (OS, Node version, etc.)

## Happy Monitoring! 🚀

The Staking Command Center is now ready to help you monitor and understand Polkadot/Kusama staking operations.
