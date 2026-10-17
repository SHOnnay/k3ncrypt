import type { Request, Response, NextFunction } from 'express';
import { prekeyReadRateLimit } from './prekeys';
import { createControlRateLimit } from '../../middleware/controlRateLimit';

test('public prekey read checks keep a 20 burst and refill two/sec; mutation policy remains strict', () => {
  jest.useFakeTimers();
  try {
    const req = { ip: 'disposable-fixture', route: { path: '/:address' } } as Request;
    const send = jest.fn(); const set = jest.fn(); const status = jest.fn().mockReturnValue({ send });
    const res = { status, set } as unknown as Response;
    const next = jest.fn() as NextFunction;
    for (let i = 0; i < 20; i++) prekeyReadRateLimit(req, res, next);
    prekeyReadRateLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(20); expect(status).toHaveBeenCalledWith(429); expect(set).toHaveBeenCalledWith('Retry-After', '1');
    jest.advanceTimersByTime(1000);
    for (let i = 0; i < 3; i++) prekeyReadRateLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(22);
    // This independent limiter is also the unchanged control/mutation policy.
    const control = createControlRateLimit(); const admitted = jest.fn() as NextFunction;
    for (let i = 0; i < 21; i++) control(req, res, admitted);
    expect(admitted).toHaveBeenCalledTimes(20); expect(set).toHaveBeenLastCalledWith('Retry-After', '4');
    jest.advanceTimersByTime(1000); control(req, res, admitted); expect(admitted).toHaveBeenCalledTimes(20);
  } finally { jest.useRealTimers(); }
});
