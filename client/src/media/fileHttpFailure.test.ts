import { fileHttpFailure } from './fileHttpFailure';
import { HttpFileGateway } from './HttpFileGateway';
import type { FileBinding } from '@chat-e2ee/service';

it.each([undefined, '1', '4', '30', 'Wed, 21 Oct 2037 07:28:00 GMT', 'invalid'])('does not infer quota from Retry-After %s', async retry => {
  const error = await fileHttpFailure(new Response('{"error":"Rate limit exceeded"}', { status: 429, headers: retry ? { 'Retry-After': retry } : {} }));
  expect(error).toMatchObject({ message: 'Rate limit exceeded.', safeDiagnosticCode: 'FILE_RATE_LIMITED' });
});
it('requires an explicit server quota category; never reflects private error contents', async () => {
  expect(await fileHttpFailure(new Response('{"failure":"quota"}', { status: 429 }))).toMatchObject({ safeDiagnosticCode: 'FILE_QUOTA_EXCEEDED' });
  for (const body of ['not-json', '{"error":"private-value"}', '{"failure":"authorization"}', 'x'.repeat(2048)]) {
    const error = await fileHttpFailure(new Response(body, { status: 429 }));
    expect(error).toMatchObject({ safeDiagnosticCode: 'FILE_RATE_LIMITED' });
    expect(error.message).not.toContain('private-value');
  }
});
it.each([[401, 'FILE_AUTHORIZATION_FAILED'], [403, 'FILE_AUTHORIZATION_FAILED'], [503, 'FILE_SERVICE_UNAVAILABLE'], [502, 'FILE_SERVICE_UNAVAILABLE'], [504, 'FILE_SERVICE_UNAVAILABLE'], [410, 'FILE_TRANSFER_EXPIRED'], [409, 'FILE_SERVER_STATE_CONFLICT']])('classifies status %s with a fixed code', async (status, code) => {
  expect(await fileHttpFailure(new Response('private-server-details', { status: Number(status) }))).toMatchObject({ safeDiagnosticCode: code });
});
it('bounds stalled error-body processing and cancels its reader', async () => {
  jest.useFakeTimers();
  const canceled = jest.fn();
  const result = fileHttpFailure(new Response(new ReadableStream({ cancel: canceled }), { status: 429 }));
  await jest.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({ safeDiagnosticCode: 'FILE_RATE_LIMITED' });
  expect(canceled).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
it('respects explicit retry delay, bounds attempts, and terminates allocation failure', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":"Rate limit exceeded"}', { status: 429, headers: { 'Retry-After': '4' } }));
  try {
    const gateway = new HttpFileGateway('https://stage.invalid', async () => ({}));
    const result = gateway.create({} as FileBinding, 1, new AbortController().signal).catch(error => error);
    await jest.advanceTimersByTimeAsync(3999); expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(8000);
    expect(await result).toMatchObject({ safeDiagnosticCode: 'FILE_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  } finally { fetchMock.mockRestore(); jest.useRealTimers(); }
});
it('does not retry quota, unavailable, authorization, or long-delay failures automatically', async () => {
  for (const [status, body, retry, code] of [[429, '{"failure":"quota"}', '', 'FILE_QUOTA_EXCEEDED'], [503, '{}', '', 'FILE_SERVICE_UNAVAILABLE'], [403, '{}', '', 'FILE_AUTHORIZATION_FAILED'], [429, '{}', '30', 'FILE_RATE_LIMITED']] as const) {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status, headers: retry ? { 'Retry-After': retry } : {} }));
    try {
      const gateway = new HttpFileGateway('https://stage.invalid', async () => ({}));
      await expect(gateway.create({} as FileBinding, 1, new AbortController().signal)).rejects.toMatchObject({ safeDiagnosticCode: code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  }
});
