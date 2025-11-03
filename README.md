# Staking Command Center

Real-time monitoring dashboard for Polkadot and Kusama staking operations.

![Status](https://img.shields.io/badge/status-beta-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![TypeScript](https://img.shields.io/badge/typescript-5.3-blue)

## Overview

Staking Command Center is a developer-focused monitoring tool that provides real-time insights into Polkadot and Kusama staking operations. It tracks eras, sessions, elections, and system anomalies, making it easier to debug and understand staking behavior.

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
- (Optional) Docker for containerized deployment

### Local Development

```bash
# 1. Clone repository
git clone <repository-url>
cd staking-command-center

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set CHAIN=polkadot or kusama

# 4. Build all packages
npm run build

# 5. Start all services
npm run dev
```

The services will be available at:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000

### Docker Deployment

```bash
# Start both Polkadot and Kusama instances
docker-compose up -d

# Polkadot API: http://localhost:4000
# Kusama API: http://localhost:4001

# View logs
docker-compose logs -f polkadot-indexer

# Stop services
docker-compose down
```

## Configuration

### Environment Variables

Create a `.env` file:

```bash
CHAIN=polkadot          # or kusama
DB_PATH=./data/staking.db
MAX_ERAS=100            # Number of eras to retain
LOG_LEVEL=info          # debug, info, warn, error
API_PORT=4000
API_HOST=0.0.0.0
```

### RPC Endpoints

Edit `config/rpc-endpoints.json` to customize RPC endpoint pools. The indexer automatically fails over to the next endpoint if one becomes unavailable.

## API Reference

### REST Endpoints

```bash
# Health check
GET /api/health

# Current status
GET /api/status

# List eras
GET /api/eras?limit=20

# Era details
GET /api/eras/:eraIndex

# Warnings
GET /api/warnings?limit=50&severity=error

# Session details
GET /api/sessions/:sessionIndex

# Validator points
GET /api/sessions/:sessionIndex/validator-points
GET /api/validators/:address/points

# Election phases
GET /api/eras/:eraIndex/election
GET /api/election/current

# Events
GET /api/events?type=session.NewSession&limit=100
GET /api/blocks/:blockNumber/events
```

### WebSocket Events

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

// Subscribe to updates
socket.emit('subscribe:status');
socket.emit('subscribe:warnings');
socket.emit('subscribe:eras');

// Listen for updates
socket.on('status_update', (data) => {
  console.log('Status:', data);
});

socket.on('warnings_update', (data) => {
  console.log('New warnings:', data);
});
```

## Documentation

- [Development Guide](./docs/DEVELOPMENT.md) - Detailed development instructions
- [Deployment Guide](./docs/DEPLOYMENT.md) - Production deployment options
- [Tracking Requirements](./docs/tracking-requirements.md) - Events and storage items tracked
- [Implementation Plan](./CLAUDE.md) - Architecture and design decisions

## Deployment

### Fly.io (Recommended)

```bash
# Install Fly CLI
brew install flyctl

# Login
flyctl auth login

# Create app
flyctl apps create polkadot-scc

# Create volume
flyctl volumes create staking_data --size 10 --app polkadot-scc

# Configure
cp fly.toml.example fly.toml
# Edit fly.toml with your settings

# Deploy
flyctl deploy
```

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed instructions.

## Monitoring

### Database Size

```bash
# Check database size
du -h data/*.db

# Check sync progress
sqlite3 data/polkadot.db "SELECT value FROM indexer_state WHERE key='lastProcessedBlock';"
```

### Logs

```bash
# Docker
docker-compose logs -f <service-name>

# Development
npm run dev  # Logs appear in terminal
```

## Troubleshooting

### Indexer Not Connecting

1. Check RPC endpoints in `config/rpc-endpoints.json`
2. Try setting `CUSTOM_RPC_ENDPOINT` in `.env`
3. Review indexer logs for connection errors

### API Errors

1. Ensure indexer has run and created the database
2. Check database file exists at `DB_PATH`
3. Verify correct `CHAIN` environment variable

### Frontend Not Updating

1. Check WebSocket connection in browser console
2. Verify API server is running
3. Check that both indexer and API use the same database path

## Performance

- **Database size**: ~100-150MB per 100 eras
- **Memory usage**: ~200-300MB per service
- **Block processing**: 2-5 seconds per block
- **RPC calls**: Optimized with caching

## Contributing

This is a beta project. Contributions welcome!

Areas for improvement:
- Additional warning types
- Reward claim tracking UI
- Unit test coverage
- Performance optimizations
- Additional chain support

## Roadmap

- [ ] Reward claim tracking and visualization
- [ ] Advanced election analytics
- [ ] Prometheus metrics export
- [ ] Historical data export (CSV/JSON)
- [ ] Multi-user authentication
- [ ] Slash event visualization
- [ ] Mobile-responsive UI improvements

## License

MIT

## Support

For issues, questions, or feedback:
- Open an issue on GitHub
- Review documentation in `/docs`
- Check troubleshooting section above
