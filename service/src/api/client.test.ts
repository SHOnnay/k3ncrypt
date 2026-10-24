import makeRequest from './client';
jest.mock('../configContext', () => ({ configContext: () => ({ baseUrl: 'https://synthetic.invalid' }) }));
const original = globalThis.window;
afterEach(() => { jest.useRealTimers(); Object.defineProperty(globalThis, 'window', { configurable: true, value: original }); });
it('bounds a stalled request and never retries an uncertain write', async () => {
  jest.useFakeTimers();
  const fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  const operation = makeRequest('chat-link', {method: 'POST', body: {synthetic: true}});
  const result = expect(operation).rejects.toMatchObject({name: 'AbortError'});
  await jest.advanceTimersByTimeAsync(30_000); await result; expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('preserves explicit rate-limit status and Retry-After rather than reporting a passphrase failure', async () => {
  const fetch = jest.fn(async () => new Response(JSON.stringify({error: 'rate limited'}), {status: 429, headers: {'Content-Type':'application/json', 'Retry-After':'60'}}));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  await expect(makeRequest('chat-link', {method:'POST'})).rejects.toMatchObject({status:429, retryAfterMs:60000});
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('honors bounded Retry-After before retrying an explicit rejection', async () => {
  jest.useFakeTimers();
  const fetch = jest.fn().mockResolvedValueOnce(new Response('{}', {status:429, headers:{'Retry-After':'2'}})).mockResolvedValueOnce(new Response('{"ok":true}'));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  const operation = makeRequest('chat-link', {method:'POST'});
  await jest.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); await expect(operation).resolves.toEqual({ok:true});
  expect(fetch).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
});



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
