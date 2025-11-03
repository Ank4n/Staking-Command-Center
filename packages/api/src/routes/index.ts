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
  router.get('/eras/:eraIndex', (req, res) => {
    try {
      const eraIndex = parseInt(req.params.eraIndex);
      const era = db.getEra(eraIndex);

      if (!era) {
        return res.status(404).json({ error: 'Era not found' });
      }

      res.json(era);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get era' });
    }
  });

  // ===== SESSION ENDPOINTS =====

  // Get session details
  router.get('/sessions/:sessionIndex', (req, res) => {
    try {
      const sessionIndex = parseInt(req.params.sessionIndex);
      const session = db.getSession(sessionIndex);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  // Get sessions by era
  router.get('/eras/:eraIndex/sessions', (req, res) => {
    try {
      const eraIndex = parseInt(req.params.eraIndex);
      const sessions = db.getSessionsByEra(eraIndex);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });

  // ===== ELECTION ENDPOINTS =====

  // Get election phases for an era
  router.get('/eras/:eraIndex/election', (req, res) => {
    try {
      const eraIndex = parseInt(req.params.eraIndex);
      const phases = db.getElectionPhases(eraIndex);
      res.json(phases);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get election phases' });
    }
  });

  // Get current election phase
  router.get('/election/current', (req, res) => {
    try {
      const phase = db.getCurrentElectionPhase();
      res.json(phase || { phase: 'off' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get current election phase' });
    }
  });

  // ===== VALIDATOR POINTS ENDPOINTS =====

  // Get validator points by session
  router.get('/sessions/:sessionIndex/validator-points', (req, res) => {
    try {
      const sessionIndex = parseInt(req.params.sessionIndex);
      const points = db.getValidatorPointsBySession(sessionIndex);
      res.json(points);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get validator points' });
    }
  });

  // Get validator points by address
  router.get('/validators/:address/points', (req, res) => {
    try {
      const address = req.params.address;
      const limit = parseInt(req.query.limit as string) || 10;
      const points = db.getValidatorPointsByAddress(address, Math.min(limit, 50));
      res.json(points);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get validator points' });
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

  // ===== EVENT ENDPOINTS =====

  // Get recent events
  router.get('/events', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const eventType = req.query.type as string;

      const events = eventType
        ? db.getEventsByType(eventType, Math.min(limit, 500))
        : db.getEvents(Math.min(limit, 500));

      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

  // Get events by block
  router.get('/blocks/:blockNumber/events', (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const events = db.getEventsByBlock(blockNumber);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

  return router;
}
