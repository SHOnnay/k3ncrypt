import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { connectedPair, create, invite } from './usabilityHelpers';
const fixtures = [
  { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF') },
  { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64') },
  { name: 'one-mib.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024 * 1024, 71) },
  { name: 'near-limit.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8 * 1024 * 1024 - 1024, 83) },
];
async function transfer(sender: Page, recipient: Page, file: typeof fixtures[number], output: string) {
  const before = await recipient.getByRole('button', { name: 'Download protected file', exact: true }).count();
  await sender.locator('input[type=file]').setInputFiles(file);
  await expect(sender.getByRole('group', { name: 'File attachment draft' })).toContainText(file.name);
  await expect(sender.getByRole('button', { name: 'Send file', exact: true })).toBeEnabled();
  await sender.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(sender.locator('.media-transfer-status')).toContainText(file.name, { timeout: 30000 });
  await expect(sender.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300000 });
  const buttons = recipient.getByRole('button', { name: 'Download protected file', exact: true });
  await expect(buttons).toHaveCount(before + 1); await buttons.last().click();
  const save = recipient.getByRole('link', { name: `Save ${file.name}`, exact: true });
  await expect(save).toBeVisible({ timeout: 300000 });
  const download = recipient.waitForEvent('download'); await save.click(); const artifact = await download; await artifact.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  await recipient.getByRole('button', { name: 'Close file preview', exact: true }).click();
}
test('file selection is a local draft until explicit Send, then encrypted transfer completes', async ({ browser }, testInfo) => {
  test.setTimeout(900000); const { a, b, alice, bob } = await connectedPair(browser);
  const c = await browser.newContext(); const carol = await c.newPage();
  await create(carol, 'Carol');
  const carolLink = await invite(alice);
  await carol.locator('.new-conversation').click(); await carol.getByRole('button', { name: 'I have an invitation' }).click();
  await carol.locator('#channel-hash').fill(carolLink); await carol.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Carol', { timeout: 30000 });
  await expect(carol.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  for (const page of [alice, carol]) {
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Security Your identity and contact verification', exact: true }).click();
    await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
    await page.getByRole('button', { name: 'Codes match', exact: true }).click();
    await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  }
  const file = fixtures[1];
  const requests: string[] = [];
  alice.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/attachments/v2')) requests.push(`${request.method()} ${pathname}`);
  });
  const receivedBefore = await bob.getByRole('button', { name: 'Download protected file', exact: true }).count();
  await alice.locator('input[type=file]').setInputFiles(file);
  const draft = alice.getByRole('group', { name: 'File attachment draft' });
  await expect(draft).toContainText(file.name);
  await expect(draft).toContainText('0.1 KiB');
  await expect(draft.getByRole('img', { name: `Preview of ${file.name}` })).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Send file', exact: true })).toBeVisible();
  await expect(alice.locator('.media-transfer-status')).not.toBeVisible();
  await alice.waitForTimeout(500);
  expect(requests).toEqual([]); // No upload/create request means no server-side file record or chunks.
  await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(receivedBefore);

  await alice.locator('.conversation-section .conversation-row').filter({ hasText: 'Bob' }).click();
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await expect(alice.getByRole('group', { name: 'File attachment draft' })).toHaveCount(0);
  expect(requests).toEqual([]); // A Carol-room draft cannot cross the room boundary to Bob.

  await alice.locator('input[type=file]').setInputFiles(file);
  await expect(alice.getByRole('group', { name: 'File attachment draft' })).toContainText(file.name);
  await alice.getByRole('group', { name: 'File attachment draft' }).getByRole('button', { name: 'Remove attachment', exact: true }).click();
  await expect(alice.getByRole('group', { name: 'File attachment draft' })).toHaveCount(0);
  await alice.waitForTimeout(250);
  expect(requests).toEqual([]);

  await alice.locator('input[type=file]').setInputFiles(file);
  const sendFileButton = alice.getByRole('button', { name: 'Send file', exact: true });
  await sendFileButton.click();
  await sendFileButton.dispatchEvent('click'); // Simulate a rapid duplicate activation while the first send is in flight.
  await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300000 });
  expect(requests.filter(request => request.endsWith('/create'))).toHaveLength(1);
  await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(receivedBefore + 1, { timeout: 300000 });
  const downloadButton = bob.getByRole('button', { name: 'Download protected file', exact: true }).last();
  await downloadButton.click();
  const save = bob.getByRole('link', { name: `Save ${file.name}`, exact: true });
  await expect(save).toBeVisible({ timeout: 300000 });
  const downloadEvent = bob.waitForEvent('download'); await save.click(); const download = await downloadEvent;
  const output = testInfo.outputPath('explicit-send-received.png'); await download.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  await bob.getByRole('button', { name: 'Close file preview', exact: true }).click();
  await a.close(); await b.close(); await c.close();
});
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
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await alice.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300000 });
  await alice.unroute('**/api/attachments/v2/*/chunks/*');
  let release: (() => void) | undefined; const gate = new Promise<void>(resolve => { release = resolve; });
  let uploadBlocked!: () => void; const blocked = new Promise<void>(resolve => { uploadBlocked = resolve; });
  await alice.route('**/api/attachments/v2/*/chunks/*', async route => { uploadBlocked(); await gate; await route.continue().catch(() => undefined); });
  const uploadAborted = alice.waitForEvent('requestfailed', request => request.method() === 'PUT' && new URL(request.url()).pathname.includes('/chunks/'));
  await alice.locator('input[type=file]').setInputFiles(fixtures[1]);
  await alice.getByRole('button', { name: 'Send file', exact: true }).click(); await blocked;
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

test('two verified files keep independent Save links after cancellation and release on room teardown', async ({browser},testInfo) => {
  test.setTimeout(120000);
  const {a,b,alice,bob}=await connectedPair(browser);
  try {
    for (const file of fixtures.slice(0,2)) {
      await alice.locator('input[type=file]').setInputFiles(file);
      await alice.getByRole('button',{name:'Send file',exact:true}).click();
      await expect(alice.locator('.media-transfer-status')).toContainText('Sent',{timeout:30000});
      await bob.getByRole('button',{name:'Download protected file',exact:true}).last().click();
      const save=bob.getByRole('link',{name:`Save ${file.name}`,exact:true});
      await expect(save).toBeVisible({timeout:30000});
      const started=bob.waitForEvent('download');await save.click();const download=await started;
      if(file===fixtures[0]) await download.cancel();
      else {
        const output=testInfo.outputPath('verified-second-file');await download.saveAs(output);
        expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
      }
      await expect(save).toBeVisible();
    }
    await expect(bob.getByRole('link',{name:'Save document.pdf',exact:true})).toBeVisible();
    await expect(bob.getByRole('link',{name:'Save photo.png',exact:true})).toBeVisible();
    await bob.getByRole('button',{name:'Close file preview',exact:true}).first().click();
    await expect(bob.getByRole('link',{name:'Save document.pdf',exact:true})).toHaveCount(0);
    await expect(bob.getByRole('link',{name:'Save photo.png',exact:true})).toBeVisible();
    await bob.getByRole('button',{name:'Contacts',exact:true}).click();
    await expect(bob.getByRole('link',{name:'Save photo.png',exact:true})).toHaveCount(0);
  } finally {await a.close();await b.close();}
});
