import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('real repeated maximum transfer distinguishes retained quota from rate admission and recovers with a smaller file', async ({ browser }, info) => {
  test.skip(process.env.K3NCRYPT_PHASE4C_FILES !== 'true', 'Explicit disposable loopback staging only');
  test.setTimeout(240000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    expect(new URL(alice.url()).origin).toBe('https://phase4b.localhost:3453');
    const data = Buffer.alloc(8 * 1024 * 1024, 73);
    const begin = Date.now();
    await alice.locator('input[type=file]').setInputFiles({ name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: data });
    await alice.getByRole('button', { name: 'Send file', exact: true }).click();
    await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 90000 });
    const sentMs = Date.now() - begin;
    const downloadAt = Date.now();
    await bob.getByRole('button', { name: 'Download protected file', exact: true }).click();
    const save = bob.getByRole('link', { name: 'Save synthetic.bin', exact: true });
    await expect(save).toBeVisible({ timeout: 120000 });
    const pending = bob.waitForEvent('download'); await save.click();
    const download = await pending; const output = info.outputPath('synthetic-output'); await download.saveAs(output);
    expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'));
    const downloadMs = Date.now() - downloadAt;
    await bob.getByRole('button', { name: 'Discard verified output', exact: true }).click();
    // Existing 12MiB encoded reservation limit legitimately rejects two retained8MiB transfers.
    let quotaObserved = false;
    // Observe the actual authenticated server response before the gateway cancels
    // rejected response streams during admission backoff; never export its body.
    await alice.route('**/api/attachments/v2/create', async route => {
      const response = await route.fetch({ maxRetries: 0 });
      if (response.status() === 429) {
        const body: unknown = await response.json();
        quotaObserved ||= !!body && typeof body === 'object' && 'failure' in body && body.failure === 'quota';
      }
      await route.fulfill({ response });
    });
    await alice.locator('input[type=file]').setInputFiles({ name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: data });
    await alice.getByRole('button', { name: 'Send file', exact: true }).click();
    await expect.poll(() => quotaObserved, { timeout: 20000 }).toBe(true);
    await expect(alice.locator('.media-transfer-status')).toContainText('File storage quota reached');
    await expect(alice.locator('.media-transfer-status')).not.toContainText(/Sending|Preparing/);
    await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(1);
    await alice.unroute('**/api/attachments/v2/create');
    // No server limit is changed; a small legitimate reservation still fits.
    await alice.locator('input[type=file]').setInputFiles({ name: 'small.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(23 * 1024, 31) });
    await alice.getByRole('button', { name: 'Send file', exact: true }).click();
    await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 45000 });
    await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(2);
    console.log('PHASE4C_SAFE', JSON.stringify({ bytes: data.length, sentMs, downloadMs, integrity: true, repeatFailure: 'quota', smallerRecovery: true }));
  } finally { await a.close(); await b.close(); }
});
