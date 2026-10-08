import { rateLimitedRequest } from './rateLimitedRequest';
import { configContext } from '../configContext';

export type ApiError = Error & {
  status: number
  retryAfterMs?: number
}

/**
 * Generic typed wrapper around `fetch()` for the chat-e2ee REST API.
 *
 * `TResponse` should be declared by each call site to the JSON shape it
 * expects back (see `public/types.ts`); `TBody` defaults to `unknown` so
 * request bodies still get basic type-checking without requiring every
 * caller to declare one.
 */
const makeRequest = async <TResponse, TBody = unknown>(
  url: string,
  { method = 'GET', body, headers = {} }: { method: string, body?: TBody, headers?: Record<string, string> }
): Promise<TResponse> => {
  const baseUri = configContext().baseUrl;
  const res = await rateLimitedRequest(() => window.fetch(`${baseUri}/api/${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body && { body: JSON.stringify(body) })
  }));

  if (!res.ok) {
    const json = res.headers.get('Content-Type')?.includes('application/json')
      ? await res.json()
      : await res.text();

    const err = new Error(json.message || json.error || JSON.stringify(json)) as ApiError;
    err.status = res.status;
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const dateDelay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(dateDelay) && dateDelay > 0) err.retryAfterMs = dateDelay;
    }

    throw err;
  }

  return await res.json() as TResponse;
};

export default makeRequest;
