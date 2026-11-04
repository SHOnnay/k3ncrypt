import { PrefetchedHeaders } from './prefetchedHeaders';

// Calls milestone 1: the next upload's device proof is fetched while the current chunk uploads.
describe('prefetched request headers', () => {
  it('serves a prefetched proof once, then fetches fresh', async () => {
    let n = 0; const fetch = jest.fn(async () => ({ proof: String(++n) }));
    const headers = new PrefetchedHeaders(fetch);
    headers.prefetch('attachment:write');
    expect(await headers.take('attachment:write')).toEqual({ proof: '1' });
    expect(await headers.take('attachment:write')).toEqual({ proof: '2' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never reuses a proof older than the limit and never prefetches twice', async () => {
    let now = 0; let n = 0; const fetch = jest.fn(async () => ({ proof: String(++n) }));
    const headers = new PrefetchedHeaders(fetch, () => now, 20_000);
    headers.prefetch('attachment:write'); headers.prefetch('attachment:write');
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 20_001;
    expect(await headers.take('attachment:write')).toEqual({ proof: '2' });
  });

  it('falls back to a fresh fetch when the prefetch failed', async () => {
    const fetch = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ proof: 'fresh' });
    const headers = new PrefetchedHeaders(fetch);
    headers.prefetch('attachment:write');
    expect(await headers.take('attachment:write')).toEqual({ proof: 'fresh' });
  });

  it('keeps prefetches per operation', async () => {
    const fetch = jest.fn(async (operation: string) => ({ operation }));
    const headers = new PrefetchedHeaders(fetch);
    headers.prefetch('attachment:write');
    expect(await headers.take('attachment:read')).toEqual({ operation: 'attachment:read' });
    expect(await headers.take('attachment:write')).toEqual({ operation: 'attachment:write' });
  });
});
