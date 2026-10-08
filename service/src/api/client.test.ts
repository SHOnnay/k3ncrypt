import makeRequest from './client';

it('preserves a final HTTP Retry-After value for the Mux renewal backoff', async () => {
  const previousWindow = globalThis.window;
  const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'rate limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
  }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  try {
    await expect(makeRequest('device-trust/proof', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 7_000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});
