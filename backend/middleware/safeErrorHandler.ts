import type { NextFunction, Request, Response } from 'express';
import { operationalLog } from '../operations/logger';

export const safeErrorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
  operationalLog('error', 'request_failed', { method: req.method, route: req.route?.path ?? req.path, status: 500, errorType: error instanceof Error ? error.name : 'unknown' });
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
};
