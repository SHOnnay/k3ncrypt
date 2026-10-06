import type { NextFunction, Request, Response } from 'express';
import { HttpRateLimiter } from './httpRateLimiter';

const limiter = new HttpRateLimiter(120, 2);

/** Broad endpoint boundary; capability-bearing control routes retain their stricter limiter. */
export const apiRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  if (!limiter.consume(`${req.ip}:api`)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
};
