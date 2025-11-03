FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY shared/package.json ./shared/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/api/package.json ./packages/api/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build all packages
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY shared/package.json ./shared/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/api/package.json ./packages/api/
COPY packages/frontend/package.json ./packages/frontend/

RUN npm install --production

# Copy built files from builder
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/packages/indexer/dist ./packages/indexer/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist

# Copy config
COPY config ./config

# Create data directory
RUN mkdir -p /app/data

# Expose API port
EXPOSE 4000

# Default command (can be overridden in docker-compose)
CMD ["node", "packages/indexer/dist/index.js"]
