import type { NextFunction, Request, Response } from 'express';
import { HttpRateLimiter } from './httpRateLimiter';

// M3a: one 8 MiB file both ways needs ~159 requests in ~20 s from one IP (74 are one-time device
// proofs). 120 burst / 2 per s returned 12x 429; 300 / 5 covers a family sharing one home IP.
const limiter = new HttpRateLimiter(300, 5);

/** Broad endpoint boundary; capability-bearing control routes retain their stricter limiter. */
export const apiRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  if (!limiter.consume(`${req.ip}:api`)) {
    res.set('Retry-After', '1');
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
};
