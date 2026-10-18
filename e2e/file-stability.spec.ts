import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { connectedPair } from './usabilityHelpers';

// Opt-in benchmark: synthetic data and fresh browser identities only. Never export
// request URLs/authentication headers/bodies, file names, keys, room IDs, or user content.
// Numeric Retry-After is the sole retained response-header value.
const enabled = process.env.K3NCRYPT_FILE_BENCHMARK === 'true';
if (enabled) test.use({ launchOptions: { args: ['--enable-precise-memory-info'] } });
const sizes = (process.env.K3NCRYPT_FILE_BENCH_SIZES ?? '23552,174080,314368,1258291').split(',').map(Number);
const count = Number(process.env.K3NCRYPT_FILE_BENCH_REPEATS ?? '1');
if (enabled && (sizes.length > 8 || sizes.some(size => !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024) || !Number.isInteger(count) || count < 1 || count > 5)) throw new Error('Invalid bounded synthetic benchmark configuration');
const category = (url: string, method: string): string | undefined => {
  const path = new URL(url).pathname;
  if (/\/prekeys\//.test(path)) return method === 'GET' ? 'prekey-read' : 'prekey-mutation';
  if (path.startsWith('/api/device-trust/')) return 'device-trust';
  if (!path.startsWith('/api/attachments/v2')) return path.startsWith('/api/') ? 'other-api' : undefined;
  if (path.endsWith('/create')) return 'create';
  if (path.endsWith('/manifest')) return 'manifest-upload';
  if (path.includes('/chunks/')) return method === 'PUT' ? 'chunk-upload' : 'chunk-download';
  if (path.endsWith('/complete')) return 'complete';
  return method === 'DELETE' ? 'cancel' : 'file-status';
};
async function browserMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Metric = { count: number; ms: number; bytes: number };
    const value = { crypto: {} as Record<string, Metric>, source: { count: 0, ms: 0, bytes: 0 }, heapStart: 0, heapPeak: 0, phases: [] as { phase: string; ms: number }[] };
    const target = globalThis as typeof globalThis & { __fileBenchmark?: typeof value; __stopFileBenchmark?: () => void };
    target.__stopFileBenchmark?.(); target.__fileBenchmark = value;
    const start = performance.now();
    const memory = () => { const bytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0; value.heapPeak = Math.max(value.heapPeak, bytes); return bytes; };
    value.heapStart = memory(); const timer = setInterval(memory, 500);
    const originalBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () { const at = performance.now(); try { return await originalBuffer.call(this); } finally { value.source.count++; value.source.ms += performance.now() - at; value.source.bytes += this.size; } };
    const originals = { encrypt: crypto.subtle.encrypt, decrypt: crypto.subtle.decrypt };
    for (const method of ['encrypt', 'decrypt'] as const) {
      crypto.subtle[method] = async function (algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams, key: CryptoKey, data: BufferSource) {
        const additional = (algorithm as AesGcmParams).additionalData;
        const aad = additional ? new Uint8Array(ArrayBuffer.isView(additional) ? additional.buffer.slice(additional.byteOffset, additional.byteOffset + additional.byteLength) : additional) : undefined;
        const attachment = aad && new TextDecoder().decode(aad.subarray(0, 'k3ncrypt/attachment-aad/v2'.length)) === 'k3ncrypt/attachment-aad/v2';
        const at = performance.now();
        try { return await originals[method].call(this, algorithm, key, data); }
        finally { if (attachment) { const metric = value.crypto[`${method}-${aad[28] === 1 ? 'manifest' : 'chunk'}`] ??= { count: 0, ms: 0, bytes: 0 }; metric.count++; metric.ms += performance.now() - at; metric.bytes += data.byteLength; } }
      } as SubtleCrypto[typeof method];
    }
    const observer = new MutationObserver(() => {
      const text = document.querySelector('.media-transfer-status')?.textContent ?? '';
      const phase = ['Preparing', 'Encrypting', 'Sending', 'Protecting file', 'Sent', 'Downloading', 'Verifying', 'canceled', 'expired', 'failed', 'Could not'].find(p => text.includes(p));
      if (phase && value.phases.at(-1)?.phase !== phase && value.phases.length < 256) value.phases.push({ phase, ms: Math.round(performance.now() - start) });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    target.__stopFileBenchmark = () => { clearInterval(timer); observer.disconnect(); Blob.prototype.arrayBuffer = originalBuffer; crypto.subtle.encrypt = originals.encrypt; crypto.subtle.decrypt = originals.decrypt; };
  });
}

test('opt-in authenticated file stage benchmark', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Explicit synthetic benchmark opt-in required');
  test.setTimeout(20 * 60 * 1000);
  const fixtureStart = Date.now();
  const { a, b, alice, bob } = await connectedPair(browser);
  const fixtureMs = Date.now() - fixtureStart;
  try {
    for (let repeat = 0; repeat < count; repeat++) for (const bytes of sizes) {
      const requests: { category: string; status: number; startMs: number; headersMs: number; retryAfter?: number }[] = [];
      const retryStarts = new Map<string, number>(); const retries: { category: string; waitMs: number }[] = [];
      const sent = new WeakMap<object, number>(); let origin = Date.now();
      const onRequest = (request: import('@playwright/test').Request) => { const kind = category(request.url(), request.method()); if (!kind) return; sent.set(request, Date.now()); const key = request.method() + request.url(); const waiting = retryStarts.get(key); if (waiting !== undefined) { if (retries.length < 1024) retries.push({ category: kind, waitMs: Date.now() - waiting }); retryStarts.delete(key); } };
      const onResponse = (response: import('@playwright/test').Response) => { const kind = category(response.url(), response.request().method()); if (!kind) return; const start = sent.get(response.request()) ?? Date.now(); const retry = response.headers()['retry-after']; if (response.status() === 429 && retry && /^[1-5]$/.test(retry) && retryStarts.size < 1024) retryStarts.set(response.request().method() + response.url(), Date.now()); if (requests.length >= 1024) return; requests.push({ category: kind, status: response.status(), startMs: start - origin, headersMs: Date.now() - start, ...(retry && /^\d+$/.test(retry) ? { retryAfter: Number(retry) } : {}) }); };
      for (const page of [alice, bob]) { page.on('request', onRequest); page.on('response', onResponse); await browserMetrics(page); }
      const source = Buffer.alloc(bytes, 83);
      const receivedBefore = await bob.getByRole('button', { name: 'Download protected file', exact: true }).count();
      const ticker = setInterval(() => console.log('FILE_BENCH_TICK', JSON.stringify({ elapsedMs: Date.now() - origin, categories: Object.fromEntries([...new Set(requests.map(r => r.category))].map(c => [c, requests.filter(r => r.category === c).length])), latest: requests.at(-1) })), 15000);
      const row: Record<string, unknown> = { revision: process.env.K3NCRYPT_FILE_BENCH_LABEL ?? 'candidate', bytes, repeat, fixtureMs, requests, retries };
      try {
        origin = Date.now();
        await alice.locator('input[type=file]').setInputFiles({ name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: source });
        await expect(alice.getByRole('group', { name: 'File attachment draft' })).toBeVisible(); row.selectionMs = Date.now() - origin;
        const sendAt = Date.now(); origin = sendAt;
        await alice.getByRole('button', { name: 'Send file', exact: true }).click();
        await expect(alice.locator('.media-transfer-status')).toContainText(/Sent|failed|Could not|quota|expired/i, { timeout: 240000 });
        row.sendMs = Date.now() - sendAt;
        await expect(alice.locator('.media-transfer-status')).toContainText('Sent');
        const completed = requests.find(r => r.category === 'complete' && r.status === 200);
        row.completeToSentMs = completed ? Number(row.sendMs) - completed.startMs - completed.headersMs : undefined;
        await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(receivedBefore + 1, { timeout: 30000 });
        const downloadAt = Date.now();
        await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
        const save = bob.getByRole('link', { name: 'Save synthetic.bin', exact: true });
        await expect(save).toBeVisible({ timeout: 240000 }); row.downloadReadyMs = Date.now() - downloadAt;
        const event = bob.waitForEvent('download'); await save.click(); const download = await event; const output = testInfo.outputPath(`verified-${repeat}-${bytes}`); await download.saveAs(output);
        expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'));
        row.integrity = 'PASS';
        await bob.getByRole('button', { name: 'Discard verified output', exact: true }).click();
      } catch (error) {
        row.integrity = 'INCOMPLETE'; row.elapsedMs = Date.now() - origin;
        row.terminal = 'bounded expectation failed';
        throw error;
      } finally {
        clearInterval(ticker);
        for (const [name, page] of [['sender', alice], ['recipient', bob]] as const) { row[name] = await page.evaluate(() => { const t = globalThis as typeof globalThis & { __fileBenchmark?: unknown; __stopFileBenchmark?: () => void }; t.__stopFileBenchmark?.(); return t.__fileBenchmark; }); page.off('request', onRequest); page.off('response', onResponse); }
        console.log('FILE_BENCH_SAFE', JSON.stringify(row));
        if (process.env.K3NCRYPT_FILE_BENCH_OUT) await appendFile(process.env.K3NCRYPT_FILE_BENCH_OUT, JSON.stringify(row) + '\n');
      }
    }
  } finally { await a.close(); await b.close(); }
});
