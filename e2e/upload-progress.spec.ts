import { test, expect } from '@playwright/test';
import { checkByNumbers, uncheckedPair, expectFileSent } from './usabilityHelpers';

// Part A2 bug 3. Invariant: upload progress follows bytes, not one jump per 256 KiB chunk.
test('upload progress moves smoothly while a 1 MiB file is sent on a slow uplink', async ({ browser }) => {
  test.setTimeout(240_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);
  await checkByNumbers(alice); await checkByNumbers(bob);
  const cdp = await alice.context().newCDPSession(alice);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 20_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
  await alice.locator('input[type=file]').setInputFiles({ name: 'progress.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024 * 1024, 5) });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  const seen = new Set<number>();
  const bar = alice.getByRole('progressbar', { name: 'File transfer progress' });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  while (await bar.count()) { const value = await bar.getAttribute('value').catch(() => null); if (value !== null) seen.add(Math.round(Number(value))); await alice.waitForTimeout(100); }
  await expectFileSent(alice, 120_000);
  // Four 256 KiB chunks would give at most ~5 distinct values if progress jumped per chunk.
  expect(seen.size, `progress values ${[...seen].sort((x, y) => x - y).join(',')}`).toBeGreaterThanOrEqual(10);
  await a.close(); await b.close();
});
