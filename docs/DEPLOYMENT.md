# Deployment Guide

## Deployment Options

The Staking Command Center can be deployed in several ways:

1. **Docker Compose** (Recommended for self-hosting)
2. **Fly.io** (Recommended for cloud deployment)
3. **Manual deployment** (Advanced users)

## Option 1: Docker Compose Deployment

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+

### Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd staking-command-center
```

2. **Build and start services**
```bash
docker-compose up -d
```

This will start:
- Polkadot Indexer + API (port 4000)
- Kusama Indexer + API (port 4001)

3. **Check logs**
```bash
# Polkadot indexer
docker-compose logs -f polkadot-indexer

# Kusama API
docker-compose logs -f kusama-api
```

4. **Access the services**
- Polkadot API: http://localhost:4000
- Kusama API: http://localhost:4001

### Managing Services

```bash
# Stop all services
docker-compose down

# Stop but keep data
docker-compose stop

# Restart a service
docker-compose restart polkadot-indexer

# View logs
docker-compose logs -f <service-name>

# Remove all data (WARNING: destructive)
docker-compose down -v
```

## Option 2: Fly.io Deployment

### Prerequisites

- Fly.io account
- Fly CLI installed (`brew install flyctl` or see https://fly.io/docs/hands-on/install-flyctl/)

### Deploy Polkadot Instance

1. **Login to Fly.io**
```bash
flyctl auth login
```

2. **Create Polkadot app**
```bash
flyctl apps create polkadot-scc
```

3. **Create persistent volume**
```bash
flyctl volumes create staking_data --region iad --size 10 --app polkadot-scc
```

4. **Configure fly.toml**
```bash
cp fly.toml.example fly.toml
```

Edit `fly.toml`:
```toml
app = "polkadot-scc"
primary_region = "iad"

[env]
  CHAIN = "polkadot"
  DB_PATH = "/data/staking.db"
  MAX_ERAS = "100"
  LOG_LEVEL = "info"
```

5. **Deploy**
```bash
flyctl deploy
```

6. **Check status**
```bash
flyctl status
flyctl logs
```

### Deploy Kusama Instance

Repeat the same steps with:
- App name: `kusama-scc`
- `CHAIN = "kusama"`

### Fly.io Management

```bash
# View logs
flyctl logs --app polkadot-scc

# SSH into container
flyctl ssh console --app polkadot-scc

# Scale resources
flyctl scale vm shared-cpu-1x --memory 512 --app polkadot-scc

# View metrics
flyctl metrics --app polkadot-scc

# Destroy app
flyctl apps destroy polkadot-scc
```

## Option 3: Manual Deployment

### Prerequisites

- Node.js 18+
- PM2 or systemd for process management
- Reverse proxy (nginx/caddy)

### Steps

1. **Build the project**
```bash
npm install
npm run build
```

2. **Setup environment**
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Create data directory**
```bash
mkdir -p /var/lib/staking-cc/data
```

4. **Run with PM2**

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'polkadot-indexer',
      script: './packages/indexer/dist/index.js',
      env: {
        CHAIN: 'polkadot',
        DB_PATH: '/var/lib/staking-cc/data/polkadot.db',
        MAX_ERAS: '100',
        LOG_LEVEL: 'info'
      }
    },
    {
      name: 'polkadot-api',
      script: './packages/api/dist/index.js',
      env: {
        CHAIN: 'polkadot',
        DB_PATH: '/var/lib/staking-cc/data/polkadot.db',
        API_PORT: '4000'
      }
    }
  ]
};
```

Start services:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

5. **Configure nginx** (optional)

```nginx
server {
    listen 80;
    server_name polkadot-scc.example.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:4000/api/health

# Status check
curl http://localhost:4000/api/status
```

### Database Monitoring

```bash
# Check database size
du -h data/*.db

# Check indexer progress
sqlite3 data/polkadot.db "SELECT value FROM indexer_state WHERE key='lastProcessedBlock';"

# Check recent warnings
sqlite3 data/polkadot.db "SELECT * FROM warnings ORDER BY timestamp DESC LIMIT 5;"
```

### Logs

Docker:
```bash
docker-compose logs -f <service>
```

PM2:
```bash
pm2 logs
pm2 logs polkadot-indexer
```

Fly.io:
```bash
flyctl logs --app polkadot-scc
```

## Backup and Recovery

### Backup Database

```bash
# Docker
docker-compose exec polkadot-api sqlite3 /app/data/polkadot.db ".backup /app/data/backup.db"
docker cp scc-polkadot-api:/app/data/backup.db ./backup-$(date +%Y%m%d).db

# Manual
sqlite3 data/polkadot.db ".backup data/backup-$(date +%Y%m%d).db"
```

### Restore Database

```bash
# Stop services
docker-compose stop

# Replace database
cp backup-20231201.db data/polkadot.db

# Restart services
docker-compose start
```

## Scaling Considerations

### Vertical Scaling

Increase resources for services:
- Indexer: 512MB-1GB RAM, 1-2 CPUs
- API: 256MB-512MB RAM, 1 CPU

### Horizontal Scaling

For high availability:
1. Run multiple API instances behind a load balancer
2. Use shared volume for database (read-only for API instances)
3. Run single indexer per chain (write conflicts otherwise)

### Database Optimization

If database grows too large:
```bash
# Vacuum database
sqlite3 data/polkadot.db "VACUUM;"

# Reduce MAX_ERAS
# Edit .env or docker-compose.yml
MAX_ERAS=50
```

## Security Recommendations

1. **Firewall**: Only expose necessary ports (4000, 4001)
2. **HTTPS**: Use reverse proxy with SSL/TLS
3. **Rate limiting**: Implement at nginx/load balancer level
4. **Updates**: Regularly update Node.js and dependencies
5. **Monitoring**: Set up alerts for service failures

## Troubleshooting

### Indexer not syncing

```bash
# Check RPC connectivity
docker-compose exec polkadot-indexer curl -s https://rpc.polkadot.io/health

# Check logs
docker-compose logs polkadot-indexer | grep -i error

# Restart indexer
docker-compose restart polkadot-indexer
```

### High CPU/Memory usage

```bash
# Check resource usage
docker stats

# Reduce concurrent connections or increase resources
docker-compose up -d --scale polkadot-indexer=1
```

### Database corruption

```bash
# Stop services
docker-compose stop

# Check database integrity
sqlite3 data/polkadot.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
```

## Cost Estimates

### Fly.io

- Small instance (512MB RAM): ~$3-5/month
- Medium instance (1GB RAM): ~$7-10/month
- Storage (10GB): ~$1.5/month

**Total per chain**: ~$5-12/month

### Self-hosted (VPS)

- DigitalOcean/Linode droplet (2GB RAM): $12-18/month
- Can run both chains on same instance

## Support

For deployment issues:
- Check logs first
- Review documentation in `/docs`
- Open an issue on GitHub
