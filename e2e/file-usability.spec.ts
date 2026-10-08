import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { connectedPair } from './usabilityHelpers';
const fixtures = [
  { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF') },
  { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64') },
  { name: 'one-mib.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024 * 1024, 71) },
  { name: 'near-limit.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8 * 1024 * 1024 - 1024, 83) },
];
async function transfer(sender: Page, recipient: Page, file: typeof fixtures[number], output: string) {
  const before = await recipient.getByRole('button', { name: 'Download protected file', exact: true }).count();
  await sender.locator('input[type=file]').setInputFiles(file);
  await expect(sender.locator('.media-transfer-status')).toContainText(file.name, { timeout: 30000 });
  await expect(sender.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300000 });
  const buttons = recipient.getByRole('button', { name: 'Download protected file', exact: true });
  await expect(buttons).toHaveCount(before + 1); await buttons.last().click();
  const save = recipient.getByRole('link', { name: `Save ${file.name}`, exact: true });
  await expect(save).toBeVisible({ timeout: 300000 });
  const download = recipient.waitForEvent('download'); await save.click(); const artifact = await download; await artifact.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  await recipient.getByRole('button', { name: 'Discard verified output', exact: true }).click();
}
for (const file of fixtures) test(`verified browser transfer both directions: ${file.mimeType}, ${file.buffer.length} bytes`, async ({ browser }, testInfo) => {
  test.setTimeout(900000); const { a, b, alice, bob } = await connectedPair(browser);
  const stages = new Set<string>();
  for (const page of [alice, bob]) page.on('response', response => { const pathname = new URL(response.url()).pathname; if (!pathname.startsWith('/api/attachments/v2')) return; if (!response.ok()) { console.log('FILE_HTTP_SAFE', response.request().method(), response.status()); return; } stages.add(pathname.endsWith('/create') ? 'create' : pathname.endsWith('/manifest') ? 'manifest' : pathname.includes('/chunks/') ? response.request().method() === 'PUT' ? 'chunk-upload' : 'chunk-download' : pathname.endsWith('/complete') ? 'finalize' : 'status'); });
  await expect(alice.getByText(/This transfer was interrupted/)).not.toBeVisible();
  await transfer(alice, bob, file, testInfo.outputPath('received-a'));
  await transfer(bob, alice, file, testInfo.outputPath('received-b'));
  expect([...stages].sort()).toEqual(['chunk-download', 'chunk-upload', 'create', 'finalize', 'manifest', 'status']);
  await a.close(); await b.close();
});
test('retry, cancel, next transfer, oversize photo and scoped state after reload', async ({ browser }, testInfo) => {
  test.setTimeout(900000); const { a, b, alice, bob } = await connectedPair(browser);
  let fail = true; let firstBody: Buffer | null = null;
  await alice.route('**/api/attachments/v2/*/chunks/*', async route => { if (route.request().method() !== 'PUT') return route.continue(); const body = route.request().postDataBuffer(); if (fail) { fail = false; firstBody = body; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"failure":"storage"}' }); } expect(body).toEqual(firstBody); return route.continue(); });
  await alice.locator('input[type=file]').setInputFiles(fixtures[0]);
  await alice.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300000 });
  await alice.unroute('**/api/attachments/v2/*/chunks/*');
  let release: (() => void) | undefined; const gate = new Promise<void>(resolve => { release = resolve; });
  let uploadBlocked!: () => void; const blocked = new Promise<void>(resolve => { uploadBlocked = resolve; });
  await alice.route('**/api/attachments/v2/*/chunks/*', async route => { uploadBlocked(); await gate; await route.continue().catch(() => undefined); });
  const uploadAborted = alice.waitForEvent('requestfailed', request => request.method() === 'PUT' && new URL(request.url()).pathname.includes('/chunks/'));
  await alice.locator('input[type=file]').setInputFiles(fixtures[1]); await blocked;
  const serverCanceled = alice.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith('/api/attachments/v2/'));
  await alice.getByRole('button', { name: 'Cancel', exact: true }).click(); release?.();
  await expect(alice.locator('.media-transfer-status')).toContainText('canceled'); await alice.unroute('**/api/attachments/v2/*/chunks/*');
  await Promise.all([uploadAborted, serverCanceled]);
  await transfer(alice, bob, fixtures[2], testInfo.outputPath('after-cancel'));
  await alice.locator('input[type=file]').setInputFiles({ name: 'large-photo.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(alice.locator('.composer-feedback').filter({ hasText: 'This photo is larger than the current 8 MiB limit.' })).toBeVisible();
  await alice.reload(); await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click(); await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(alice.getByText(/This transfer was interrupted/)).not.toBeVisible(); await expect(alice.locator('.media-transfer-status')).not.toBeVisible();
  await a.close(); await b.close();
});
