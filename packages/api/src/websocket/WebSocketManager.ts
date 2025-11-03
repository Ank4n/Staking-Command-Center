import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import type { Logger } from 'pino';
import type { DatabaseClient } from '../database/DatabaseClient';
import * as fs from 'fs';

export class WebSocketManager {
  private io: SocketIOServer;
  private db: DatabaseClient;
  private logger: Logger;
  private dbPath: string;
  private watchInterval: NodeJS.Timeout | null = null;
  private lastMtime: number = 0;

  constructor(httpServer: HTTPServer, db: DatabaseClient, dbPath: string, logger: Logger) {
    this.db = db;
    this.dbPath = dbPath;
    this.logger = logger.child({ component: 'WebSocket' });

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupConnectionHandlers();
    this.startDatabaseWatcher();
  }

  /**
   * Setup connection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket) => {
      this.logger.info({ socketId: socket.id }, 'Client connected');

      // Send initial status
      try {
        const status = this.db.getStatus();
        socket.emit('status', status);
      } catch (error) {
        this.logger.error({ error }, 'Failed to send initial status');
      }

      // Handle client requests
      socket.on('subscribe:status', () => {
        socket.join('status');
        this.logger.debug({ socketId: socket.id }, 'Client subscribed to status');
      });

      socket.on('subscribe:warnings', () => {
        socket.join('warnings');
        this.logger.debug({ socketId: socket.id }, 'Client subscribed to warnings');
      });

      socket.on('subscribe:eras', () => {
        socket.join('eras');
        this.logger.debug({ socketId: socket.id }, 'Client subscribed to eras');
      });

      socket.on('unsubscribe:status', () => {
        socket.leave('status');
        this.logger.debug({ socketId: socket.id }, 'Client unsubscribed from status');
      });

      socket.on('unsubscribe:warnings', () => {
        socket.leave('warnings');
        this.logger.debug({ socketId: socket.id }, 'Client unsubscribed from warnings');
      });

      socket.on('unsubscribe:eras', () => {
        socket.leave('eras');
        this.logger.debug({ socketId: socket.id }, 'Client unsubscribed from eras');
      });

      socket.on('disconnect', () => {
        this.logger.info({ socketId: socket.id }, 'Client disconnected');
      });
    });
  }

  /**
   * Watch database for changes and broadcast updates
   */
  private startDatabaseWatcher(): void {
    // Get initial mtime
    try {
      const stats = fs.statSync(this.dbPath);
      this.lastMtime = stats.mtimeMs;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get initial database mtime');
    }

    // Poll for database changes every 2 seconds
    this.watchInterval = setInterval(() => {
      this.checkDatabaseChanges();
    }, 2000);

    this.logger.info('Database watcher started');
  }

  /**
   * Check for database changes and broadcast updates
   */
  private checkDatabaseChanges(): void {
    try {
      const stats = fs.statSync(this.dbPath);

      if (stats.mtimeMs > this.lastMtime) {
        this.lastMtime = stats.mtimeMs;
        this.broadcastUpdates();
      }
    } catch (error) {
      this.logger.error({ error }, 'Error checking database changes');
    }
  }

  /**
   * Broadcast updates to subscribed clients
   */
  private broadcastUpdates(): void {
    try {
      // Broadcast status update
      const status = this.db.getStatus();
      this.io.to('status').emit('status_update', {
        type: 'status_update',
        data: status,
        timestamp: Date.now(),
      });

      // Broadcast recent warnings
      const warnings = this.db.getWarnings(10);
      if (warnings.length > 0) {
        this.io.to('warnings').emit('warnings_update', {
          type: 'warnings_update',
          data: warnings,
          timestamp: Date.now(),
        });
      }

      // Broadcast recent eras
      const eras = this.db.getEras(10);
      this.io.to('eras').emit('eras_update', {
        type: 'eras_update',
        data: eras,
        timestamp: Date.now(),
      });

      this.logger.debug('Broadcasted updates to clients');
    } catch (error) {
      this.logger.error({ error }, 'Error broadcasting updates');
    }
  }

  /**
   * Manually trigger a broadcast
   */
  triggerBroadcast(): void {
    this.broadcastUpdates();
  }

  /**
   * Stop the database watcher
   */
  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    this.io.close();
    this.logger.info('WebSocket manager stopped');
  }
}
