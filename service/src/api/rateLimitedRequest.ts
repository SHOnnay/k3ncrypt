/** Retry only an explicit admission-rate rejection, never uncertain writes or quota failures. */
export const rateLimitedRequest = async (request: () => Promise<Response>, signal?: AbortSignal): Promise<Response> => {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    const response = await request();
    if (response.status !== 429 || attempt >= 3) return response;
    const seconds = Number(response.headers.get('Retry-After'));
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 5) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new DOMException('Canceled', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, seconds * 1000);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }
};
