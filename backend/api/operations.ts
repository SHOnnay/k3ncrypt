import express from 'express';
import { healthStatus, readinessStatus } from '../operations/status';

const router = express.Router();

router.get('/health', (_req, res) => res.status(200).json(healthStatus()));
router.get('/ready', async (_req, res) => {
  try { return res.status(200).json(await readinessStatus()); }
  catch { return res.status(503).json({ status: 'not_ready' }); }
});

export default router;
