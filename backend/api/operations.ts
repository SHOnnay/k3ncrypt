import express from 'express';
import { healthStatus, readinessStatus } from '../operations/status';
import { metricsAuthorized, metricsConfigured, metricsSnapshot } from '../operations/metrics';

const router = express.Router();

router.get('/health', (_req, res) => res.status(200).json(healthStatus()));
router.get('/ready', async (_req, res) => {
  try { return res.status(200).json(await readinessStatus()); }
  catch { return res.status(503).json({ status: 'not_ready' }); }
});

/** Operator-only counters. Answers 404 unless a metrics token is configured, and 404 again for a wrong token. */
router.get('/metrics', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!metricsConfigured() || !metricsAuthorized(req.get('Authorization'))) return res.status(404).json({ error: 'Not found' });
  try { return res.status(200).json(await metricsSnapshot()); }
  catch { return res.status(503).json({ status: 'unavailable' }); }
});

export default router;
