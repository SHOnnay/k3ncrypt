import type { NextFunction, Request, Response } from 'express';

import { RateLimiter } from '../socket.io/rateLimiter';

export const createControlRateLimit = (capacity = 20, refillPerSecond = 0.25) => {
  const limiter = new RateLimiter({ capacity, refillPerSecond });
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.baseUrl}:${req.route?.path ?? req.path}`;
    if (!limiter.consume(key)) {
      res.status(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    next();
  };
};

/** Bounds room creation, presence lookup, status, and destructive operations per client address. */
export const controlRateLimit = createControlRateLimit();
