import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connectedPair } from './usabilityHelpers';
const file = { name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1258291, 73) };
async function attach(page: Page) {
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Send file', exact: true }).click();
}
async function verifyDownload(page: Page, output: string) {
  await page.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
  const save = page.getByRole('link', { name: 'Save synthetic.bin', exact: true });
  await expect(save).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent('download'); await save.click(); const download = await pending; await download.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  await page.getByRole('button', { name: 'Discard verified output', exact: true }).click();
}

test('pre-allocation 429 terminates with honest feedback after bounded retries, then a new transfer works', async ({ browser }, info) => {
  test.setTimeout(180000); const { a, b, alice, bob } = await connectedPair(browser);
  try {
    let attempts = 0;
    await alice.route('**/api/attachments/v2/create', route => { attempts++; return route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Allow-Origin': new URL(alice.url()).origin, 'Access-Control-Expose-Headers': 'Retry-After' }, contentType: 'application/json', body: '{"error":"Rate limit exceeded"}' }); });
    await attach(alice);
    await expect(alice.locator('.media-transfer-status')).toContainText('The file service is busy', { timeout: 10000 });
    expect(attempts).toBe(4);
    await expect(alice.locator('.media-transfer-status')).not.toContainText('Preparing');
    await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(0);
    await alice.unroute('**/api/attachments/v2/create');
    await attach(alice); await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 60000 });
    await verifyDownload(bob, info.outputPath('after-rate-limit'));
  } finally { await a.close(); await b.close(); }
});

test('preparing remains cancelable while encrypted chat works; late allocation cannot publish a file', async ({ browser }, info) => {
  test.setTimeout(180000); const { a, b, alice, bob } = await connectedPair(browser);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const requested = new Promise<void>(resolve => { entered = resolve; });
  try {
    await alice.route('**/api/attachments/v2/create', async route => { entered(); await gate; await route.abort('aborted').catch(() => undefined); });
    await attach(alice); await requested;
    await expect(alice.locator('.media-transfer-status')).toContainText('Preparing');
    await bob.locator('textarea.message-input').fill('Concurrent disposable test message');
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(alice.locator('.message-text').filter({ hasText: 'Concurrent disposable test message' })).toBeVisible();
    await alice.locator('.media-transfer-status').getByRole('button', { name: 'Cancel', exact: true }).click();
    release();
    await expect(alice.locator('.media-transfer-status')).toContainText('Transfer canceled');
    await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(0);
    await alice.unroute('**/api/attachments/v2/create');
    await attach(alice); await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 60000 });
    await verifyDownload(bob, info.outputPath('after-preparing-cancel'));
  } finally { release(); await a.close(); await b.close(); }
});
