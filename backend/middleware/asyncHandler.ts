import { Request, Response } from 'express';
import { operationalLog } from '../operations/logger';
export default (fn) => (req: Request, res: Response, next) => {
  Promise.resolve(fn(req, res, next)).catch((e) => {
    operationalLog('error', 'request_failed', { method: req.method, route: req.route?.path ?? req.path, status: 500, errorType: e instanceof Error ? e.name : 'unknown' });
    return res.status(500).send({ error: 'Internal server error' });
  });
};
