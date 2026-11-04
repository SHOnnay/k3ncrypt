import { test, expect, type Page } from '@playwright/test';
import { checkByNumbers, uncheckedPair, expectFileSent } from './usabilityHelpers';

// M2 measurement, opt-in: K3NCRYPT_FILE_TIMING=true. Emulates a slow round trip to the server
// (Render Free seen from a home connection) with Chromium network conditions, then records
// where a file send and receive spend their time. Not a pass/fail gate.
const enabled = process.env.K3NCRYPT_FILE_TIMING === 'true';
const latencyMs = Number(process.env.K3NCRYPT_FILE_TIMING_LATENCY_MS ?? 150);
const upMbit = Number(process.env.K3NCRYPT_FILE_TIMING_UP_MBIT ?? 1);
const downMbit = Number(process.env.K3NCRYPT_FILE_TIMING_DOWN_MBIT ?? 2.5);
const sizes = (process.env.K3NCRYPT_FILE_TIMING_SIZES ?? `${23 * 1024},${170 * 1024},${1024 * 1024}`).split(',').map(Number);

async function slowNetwork(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: latencyMs, downloadThroughput: downMbit * 1_000_000 / 8, uploadThroughput: upMbit * 1_000_000 / 8 /* bytes per second; defaults 2.5 Mbit/s down, 1 Mbit/s up */ });
}

const categorize = (path: string) => path.includes('/device-trust/proof') ? 'device proof'
  : /\/prekeys\//.test(path) ? 'contact bundle lookup'
    : /\/chunks\//.test(path) ? 'chunk'
      : path.endsWith('/create') ? 'create' : path.endsWith('/complete') ? 'complete' : path.endsWith('/manifest') ? 'manifest'
        : /\/attachments\/v2\/[^/]+$/.test(path) ? 'status' : 'other';

for (const size of sizes) test(`file timing at ${latencyMs} ms latency: ${size} bytes`, async ({ browser }) => {
  test.skip(!enabled, 'Opt-in measurement: K3NCRYPT_FILE_TIMING=true');
  test.setTimeout(300_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);
  await checkByNumbers(alice); await checkByNumbers(bob);
  await slowNetwork(alice); await slowNetwork(bob);
  const calls: { who: string; kind: string; ms: number; at: number }[] = []; let t0 = 0;
  for (const [who, page] of [['send', alice], ['receive', bob]] as const) page.on('requestfinished', async (request) => {
    const url = new URL(request.url()); if (!t0 || !url.pathname.startsWith('/api/')) return;
    const timing = request.timing(); calls.push({ who, kind: categorize(url.pathname), ms: Math.round(timing.responseEnd), at: Date.now() - t0 });
  });
  t0 = Date.now();
  await alice.locator('input[type=file]').setInputFiles({ name: 'm.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 9) });
  const selected = Date.now() - t0;
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expectFileSent(alice, 240_000);
  const sent = Date.now() - t0;
  await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
  await expect(bob.getByRole('link', { name: 'Save m.bin', exact: true })).toBeVisible({ timeout: 240_000 });
  const opened = Date.now() - t0;
  const summary: Record<string, { calls: number; totalMs: number }> = {};
  for (const call of calls) { const key = `${call.who}: ${call.kind}`; summary[key] ??= { calls: 0, totalMs: 0 }; summary[key].calls++; summary[key].totalMs += call.ms; }
  console.log('FILE_TIMING', JSON.stringify({ size, latencyMs, upMbit, sendCalls: calls.filter((call) => call.who === 'send').map((call) => `${call.at}:${call.kind}:${call.ms}`), selectedMs: selected, sentMs: sent, receiverOpenedMs: opened - sent, totalMs: opened, apiCalls: calls.length, summary }));
  await a.close(); await b.close();
});
