import type { NextFunction, Request, Response } from 'express';

import { HttpRateLimiter } from './httpRateLimiter';

export const createControlRateLimit = (capacity = 20, refillPerSecond = 0.25) => {
  const limiter = new HttpRateLimiter(capacity, refillPerSecond);
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:control:${req.route?.path ?? "unmatched"}`;
    if (!limiter.consume(key)) {
      res.status(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    next();
  };
};

/** Bounds room creation, presence lookup, status, and destructive operations per client address. */
export const controlRateLimit = createControlRateLimit();
