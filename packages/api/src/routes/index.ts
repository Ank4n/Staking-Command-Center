import { Router } from 'express';
import type { DatabaseClient } from '../database/DatabaseClient';

export function createRouter(db: DatabaseClient): Router {
  const router = Router();

  // Health check
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Get current status
  router.get('/status', (req, res) => {
    try {
      const status = db.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // Get database stats
  router.get('/stats', (req, res) => {
    try {
      const stats = db.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // ===== BLOCK ENDPOINTS =====

  // Get recent blocks from Relay Chain
  router.get('/blocks/rc', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const blocks = db.getBlocksRC(Math.min(limit, 1000));
      res.json(blocks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get RC blocks' });
    }
  });

  // Get recent blocks from Asset Hub
  router.get('/blocks/ah', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const blocks = db.getBlocksAH(Math.min(limit, 1000));
      res.json(blocks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get AH blocks' });
    }
  });

  // Get specific block from Relay Chain
  router.get('/blocks/rc/:blockNumber', (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const block = db.getBlockRC(blockNumber);

      if (!block) {
        return res.status(404).json({ error: 'Block not found' });
      }

      res.json(block);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get RC block' });
    }
  });

  // Get specific block from Asset Hub
  router.get('/blocks/ah/:blockNumber', (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const block = db.getBlockAH(blockNumber);

      if (!block) {
        return res.status(404).json({ error: 'Block not found' });
      }

      res.json(block);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get AH block' });
    }
  });

  // ===== ERA ENDPOINTS =====

  // Get list of eras
  router.get('/eras', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const eras = db.getEras(Math.min(limit, 200));
      res.json(eras);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get eras' });
    }
  });

  // Get era details
  router.get('/eras/:eraId', (req, res) => {
    try {
      const eraId = parseInt(req.params.eraId);
      const era = db.getEra(eraId);

      if (!era) {
        return res.status(404).json({ error: 'Era not found' });
      }

      res.json(era);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get era' });
    }
  });

  // ===== SESSION ENDPOINTS =====

  // Get list of sessions
  router.get('/sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const sessions = db.getSessions(Math.min(limit, 200));
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });

  // Get session details
  router.get('/sessions/:sessionId', (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  // Get events by era
  router.get('/eras/:eraId/events/ah', (req, res) => {
    try {
      const eraId = parseInt(req.params.eraId);
      const events = db.getEventsByEraAH(eraId);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get era events' });
    }
  });

  // Get sessions by era
  router.get('/eras/:eraId/sessions', (req, res) => {
    try {
      const eraId = parseInt(req.params.eraId);
      const sessions = db.getSessionsByEra(eraId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });

  // ===== WARNING ENDPOINTS =====

  // Get recent warnings
  router.get('/warnings', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const severity = req.query.severity as string;

      const warnings = severity
        ? db.getWarningsBySeverity(severity, Math.min(limit, 500))
        : db.getWarnings(Math.min(limit, 500));

      res.json(warnings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get warnings' });
    }
  });

  // Get warnings by era
  router.get('/eras/:eraIndex/warnings', (req, res) => {
    try {
      const eraIndex = parseInt(req.params.eraIndex);
      const warnings = db.getWarningsByEra(eraIndex);
      res.json(warnings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get warnings' });
    }
  });

  // ===== ELECTION PHASE ENDPOINTS =====

  // Get election phases for an era
  router.get('/eras/:eraId/elections', (req, res) => {
    try {
      const eraId = parseInt(req.params.eraId);
      const phases = db.getElectionPhasesByEra(eraId);
      res.json(phases);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get election phases' });
    }
  });

  // Get all election phases
  router.get('/elections/phases', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const phases = db.getAllElectionPhases(Math.min(limit, 200));
      res.json(phases);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get election phases' });
    }
  });

  // ===== EVENT ENDPOINTS =====

  // Get recent events from Relay Chain
  router.get('/events/rc', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 1000;
      const eventType = req.query.type as string;

      const events = eventType
        ? db.getEventsByTypeRC(eventType, Math.min(limit, 5000))
        : db.getEventsRC(Math.min(limit, 5000));

      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get RC events' });
    }
  });

  // Get recent events from Asset Hub
  router.get('/events/ah', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 1000;
      const eventType = req.query.type as string;

      const events = eventType
        ? db.getEventsByTypeAH(eventType, Math.min(limit, 5000))
        : db.getEventsAH(Math.min(limit, 5000));

      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get AH events' });
    }
  });

  // Get events by block from Relay Chain
  router.get('/blocks/rc/:blockNumber/events', (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const events = db.getEventsByBlockRC(blockNumber);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get RC events' });
    }
  });

  // Get events by block from Asset Hub
  router.get('/blocks/ah/:blockNumber/events', (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const events = db.getEventsByBlockAH(blockNumber);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get AH events' });
    }
  });

  // ===== DATABASE VIEWER ENDPOINTS (for advanced tab) =====

  // Get all table names
  router.get('/database/tables', (req, res) => {
    try {
      const tables = db.getTables();
      res.json(tables);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get tables' });
    }
  });

  // Get table schema
  router.get('/database/:tableName/schema', (req, res) => {
    try {
      const tableName = req.params.tableName;
      const schema = db.getTableSchema(tableName);
      res.json(schema);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get table schema' });
    }
  });

  // Get table data
  router.get('/database/:tableName/data', (req, res) => {
    try {
      const tableName = req.params.tableName;
      const limit = parseInt(req.query.limit as string) || 100;
      const data = db.getTableData(tableName, Math.min(limit, 1000));
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get table data' });
    }
  });

  return router;
}
