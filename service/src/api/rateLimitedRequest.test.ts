import { rateLimitedRequest } from './rateLimitedRequest';
it('retries only bounded explicit rate admission, not quota or uncertain failures', async () => {
  jest.useFakeTimers();
  const request = jest.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValue(new Response('{}', { status: 200 }));
  const result = rateLimitedRequest(request); await jest.advanceTimersByTimeAsync(1000); expect((await result).status).toBe(200); expect(request).toHaveBeenCalledTimes(2);
  for (const response of [new Response('{}', { status: 429 }), new Response('{}', { status: 503 }), new Response('{}', { status: 429, headers: { 'Retry-After': '999' } })]) { const once = jest.fn().mockResolvedValue(response); await rateLimitedRequest(once); expect(once).toHaveBeenCalledTimes(1); }
  jest.useRealTimers();
});
it('honors cancellation during rate backoff', async () => {
  const abort = new AbortController(); const request = jest.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }));
  const result = rateLimitedRequest(request, abort.signal); abort.abort(); await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});
