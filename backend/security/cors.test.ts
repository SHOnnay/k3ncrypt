import { allowedCorsOrigins, corsOrigin } from './cors';

describe('CORS allowlist', () => {
  const original = process.env.K3NCRYPT_ALLOWED_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.K3NCRYPT_ALLOWED_ORIGINS;
    else process.env.K3NCRYPT_ALLOWED_ORIGINS = original;
  });

  it('uses an explicit configured allowlist', () => {
    process.env.K3NCRYPT_ALLOWED_ORIGINS = 'https://chat.example, https://staging.example';
    expect(allowedCorsOrigins()).toEqual(['https://chat.example', 'https://staging.example']);
    const callback = jest.fn();
    corsOrigin('https://evil.example', callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('allows non-browser requests without an Origin header', () => {
    const callback = jest.fn();
    corsOrigin(undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
