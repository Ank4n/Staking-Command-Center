# Staking Command Center

Real-time monitoring dashboard for Polkadot and Kusama staking operations.

![Status](https://img.shields.io/badge/status-beta-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![TypeScript](https://img.shields.io/badge/typescript-5.3-blue)

## Overview

Developer-focused monitoring tool providing real-time insights into Polkadot and Kusama staking operations. Tracks eras, sessions, elections, validator performance, and system anomalies.

## Features

### Core Monitoring
- ✅ **Era & Session Tracking** - Live monitoring of era/session progression
- ✅ **Election Phases** - Track election lifecycle (Off, Signed, Unsigned, Emergency)
- ✅ **Validator Points** - Monitor validator performance across sessions
- ✅ **System Warnings** - Automated detection of timing anomalies and unexpected events

### Infrastructure
- ✅ **Automatic RPC Failover** - Seamless switching between 10+ public endpoints
- ✅ **Real-time Updates** - WebSocket-based live dashboard
- ✅ **Historical Data** - SQLite database with 100 eras of retention
- ✅ **Multi-chain Support** - Separate instances for Polkadot and Kusama

## Architecture

```
┌─────────────────────────────────────────┐
│  Frontend (React + WebSocket)          │
├─────────────────────────────────────────┤
│  API Server (Express + Socket.io)      │
├─────────────────────────────────────────┤
│  Indexer Service (Block Listener)      │
│  - polkadot-js/api                     │
│  - Event processors                     │
├─────────────────────────────────────────┤
│  SQLite Database (~100-150MB)          │
└─────────────────────────────────────────┘
```

### Packages

- **indexer** (`packages/indexer`) - Block listener that processes staking events and stores data
- **api** (`packages/api`) - REST API and WebSocket server for querying data
- **frontend** (`packages/frontend`) - React dashboard with live updates
- **shared** (`shared`) - Shared TypeScript types and utilities

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9
- Docker (optional, for containerized deployment)

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (optional - defaults to Polkadot)
cp .env.example .env
# Edit .env to set CHAIN=polkadot or kusama

# 3. Start all services in order (recommended)
npm run dev:ordered
```

**Services will be available at:**
- Frontend: http://localhost:3000
- API: http://localhost:4000

**Logs:** `logs/indexer.log` and `logs/api.log`

**Alternative:** Use `npm run dev` to start all services in parallel (may require manual restart if order matters)

### Docker Deployment

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f staking-polkadot

# Stop
docker-compose down
```

**Services:**
- Polkadot instance: http://localhost:4000
- Data persisted in `./data` directory

## Configuration

Key environment variables in `.env`:

```bash
CHAIN=polkadot              # Chain: polkadot, kusama, or westend
SYNC_BLOCKS=14000           # Blocks to sync on startup (10 for dev, 14400 for prod)
DB_PATH=./data/staking.db   # Database location
MAX_ERAS=100                # Historical data retention
LOG_LEVEL=info              # Logging: debug, info, warn, error
API_PORT=4000               # API server port
```

**RPC Endpoints:** Automatically uses public endpoints from `config/rpc-endpoints.json` with failover support. Set `CUSTOM_RPC_ENDPOINT` in `.env` to override.

## API Reference

### REST Endpoints

```bash
GET /api/health                              # Health check
GET /api/status                              # Current chain status
GET /api/eras?limit=20                       # List eras
GET /api/eras/:eraIndex                      # Era details
GET /api/eras/:eraIndex/election             # Election data
GET /api/sessions/:sessionIndex              # Session details
GET /api/warnings?limit=50&severity=error    # System warnings
GET /api/events?type=session.NewSession      # Event log
```

### WebSocket

```javascript
const socket = io('http://localhost:4000');
socket.emit('subscribe:status');
socket.on('status_update', (data) => console.log(data));
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Architecture, design decisions, and implementation notes
- [docs/](./docs/) - Additional guides and tracking requirements

## Troubleshooting

**Indexer won't connect:**
- Check RPC endpoints in `config/rpc-endpoints.json`
- Set `CUSTOM_RPC_ENDPOINT` in `.env` to use a specific endpoint
- Review logs: `logs/indexer.log`

**Frontend not updating:**
- Verify API server is running: `curl http://localhost:4000/api/health`
- Check WebSocket connection in browser console
- Ensure indexer and API use same `DB_PATH`

**Check sync progress:**
```bash
sqlite3 data/staking-polkadot.db "SELECT * FROM sync_state"
```

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Clean build artifacts
npm run clean

# Rebuild everything
npm run build

# Reimport a block (useful for debugging)
npm run reimport -- <chain> <blockNumber>
```

## License

MIT
