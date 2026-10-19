/** Only fixed categories escape this parser; never display or log server bodies. */
const failureCategory = async (response: Response): Promise<string | undefined> => {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<string | undefined> => {
    let size = 0; let text = ''; const decoder = new TextDecoder();
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 1024) return undefined;
      text += decoder.decode(part.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return value && typeof value === 'object' && 'failure' in value && value.failure === 'quota' ? 'quota' : undefined;
  };
  try {
    return await Promise.race([read(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1000); })]);
  } catch { return undefined; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
};

export const fileHttpFailure = async (response: Response): Promise<Error> => {
  const quota = response.status === 429 && await failureCategory(response) === 'quota';
  if (response.status !== 429) void response.body?.cancel().catch(() => undefined);
  const authorization = response.status === 401 || response.status === 403;
  const unavailable = response.status === 502 || response.status === 503 || response.status === 504;
  const message = authorization ? 'File authorization rejected.' : response.status === 429 ? quota ? 'File quota reached.' : 'Rate limit exceeded.' : response.status === 410 ? 'File expired.' : unavailable ? 'File service temporarily unavailable.' : 'File request rejected.';
  const safeDiagnosticCode = authorization ? 'FILE_AUTHORIZATION_FAILED' : response.status === 429 ? quota ? 'FILE_QUOTA_EXCEEDED' : 'FILE_RATE_LIMITED' : response.status === 410 ? 'FILE_TRANSFER_EXPIRED' : unavailable ? 'FILE_SERVICE_UNAVAILABLE' : response.status === 409 ? 'FILE_SERVER_STATE_CONFLICT' : undefined;
  return Object.assign(new Error(message), { safeDiagnosticCode });
};
