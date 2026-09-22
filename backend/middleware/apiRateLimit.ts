import type { NextFunction, Request, Response } from 'express';
import { RateLimiter } from '../socket.io/rateLimiter';

const limiter = new RateLimiter({ capacity: 120, refillPerSecond: 2 });

/** Broad endpoint boundary; capability-bearing control routes retain their stricter limiter. */
export const apiRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  if (!limiter.consume(`${req.ip}:${req.baseUrl}:${req.path}`)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
};
