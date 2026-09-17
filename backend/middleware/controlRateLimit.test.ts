import type { NextFunction, Request, Response } from 'express';

import { createControlRateLimit } from './controlRateLimit';

describe('control endpoint abuse limiter', () => {
  it('rejects requests after the configured burst', () => {
    const middleware = createControlRateLimit(2, 0);
    const request = { ip: '127.0.0.1', baseUrl: '/api/chat-link', path: '/room' } as Request;
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    const response = { status } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);
    middleware(request, response, next);
    middleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith(429);
    expect(send).toHaveBeenCalledWith({ error: 'Rate limit exceeded' });
  });
});
