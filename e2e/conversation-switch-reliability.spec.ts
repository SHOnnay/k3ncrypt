import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { connectedPair, create, invite } from './usabilityHelpers';

const passphrase = 'alpha-family-existing-account-2026';
const jpeg20KiB = (): Buffer => {
  const base = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==', 'base64');
  const targetSize = 20 * 1024;
  const payloadSize = targetSize - base.length - 4;
  const comment = Buffer.alloc(payloadSize + 4);
  comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(payloadSize + 2, 2);
  return Buffer.concat([base.subarray(0, 2), comment, base.subarray(2)]);
};

async function sendText(sender: Page, recipient: Page, wrongPeer: Page, text: string) {
  const composer = sender.locator('.chat-footer input[type=text], .chat-footer textarea');
  await composer.fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(recipient.locator('.message-text').filter({ hasText: text })).toBeVisible({ timeout: 30000 });
  await expect(wrongPeer.locator('.message-text').filter({ hasText: text })).toHaveCount(0);
}

async function fileTransfer(sender: Page, recipient: Page, file: Buffer, output: string) {
  const filename = 'switch-20k.jpg';
  const before = await recipient.getByRole('button', { name: 'Download protected file', exact: true }).count();
  await sender.locator('input[type=file]').setInputFiles({ name: filename, mimeType: 'image/jpeg', buffer: file });
  await expect(sender.locator('.media-transfer-status')).toContainText('Sent', { timeout: 180000 });
  const buttons = recipient.getByRole('button', { name: 'Download protected file', exact: true });
  await expect(buttons).toHaveCount(before + 1, { timeout: 30000 });
  await buttons.last().click();
  const save = recipient.getByRole('link', { name: `Save ${filename}`, exact: true });
  await expect(save).toBeVisible({ timeout: 180000 });
  const download = recipient.waitForEvent('download'); await save.click();
  const artifact = await download; await artifact.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex'))
    .toBe(createHash('sha256').update(file).digest('hex'));
  await recipient.getByRole('button', { name: 'Discard verified output', exact: true }).click();
}

async function openContact(page: Page, name: string) {
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await row.click();
  try { await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30000 }); }
  catch (error) {
    const active = await page.locator('.conversation-row.active').innerText().catch(() => 'none');
    const failure = await page.locator('.app-error').innerText().catch(() => 'none');
    const stage = await page.locator('html').getAttribute('data-k3ncrypt-conversation-open').catch(() => 'none');
    console.log('SWITCH_SAFE_STATE', `target=${name};active=${active};failure=${failure};stage=${stage}`);
    throw error;
  }
  await expect(page.getByRole('textbox', { name: 'Write a message', exact: true })).toBeEnabled();
}

async function verify(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
}

test('a newer active-room selection supersedes a pending conversation candidate', async ({ browser }) => {
  test.setTimeout(180000);
  const { a, b, alice } = await connectedPair(browser);
  const c = await browser.newContext(); const cara = await c.newPage(); await create(cara, 'Cara');
  const invitation = await invite(alice);
  await cara.locator('.new-conversation').click(); await cara.getByRole('button', { name: 'I have an invitation' }).click();
  await cara.locator('#channel-hash').fill(invitation); await cara.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Cara', { timeout: 30000 });
  await verify(alice); await verify(cara);
  await openContact(alice, 'Bob');
  await openContact(alice, 'Bob');
  await a.close(); await b.close(); await c.close();
});

test('three profiles preserve room ownership through 20 switch rounds, 20 KiB files, refresh, and declines', async ({ browser }, testInfo) => {
  test.setTimeout(900000);
  const { a, b, alice, bob } = await connectedPair(browser);
  const c = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const cara = await c.newPage(); await create(cara, 'Cara');
  const invitation = await invite(alice);
  await cara.locator('.new-conversation').click(); await cara.getByRole('button', { name: 'I have an invitation' }).click();
  await cara.locator('#channel-hash').fill(invitation); await cara.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Cara', { timeout: 30000 });
  await expect(cara.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  await verify(alice); await verify(cara);
  let releaseCandidate!: () => void;
  let requestCandidate!: () => void;
  let blockFirstCandidate = true;
  const candidateRequested = new Promise<void>(resolve => { requestCandidate = resolve; });
  await alice.route('**/api/chat-link/*/prekeys/*', async route => {
    if (blockFirstCandidate) {
      blockFirstCandidate = false;
      requestCandidate();
      await new Promise<void>(resolve => { releaseCandidate = resolve; });
    }
    await route.continue();
  });
  const openCaraCandidate = alice.locator('.conversation-row').filter({ hasText: 'Cara' }).click();
  await candidateRequested;
  await expect(alice.locator('.chat-header')).toContainText('Opening Cara');
  await alice.locator('.conversation-row').filter({ hasText: 'Bob' }).click();
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await expect(alice.locator('.chat-header')).not.toContainText('Opening Cara');
  releaseCandidate();
  await openCaraCandidate;
  await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30000 });
  await expect(alice.locator('.chat-header')).not.toContainText('Opening Cara');
  await alice.unroute('**/api/chat-link/*/prekeys/*');
  await alice.evaluate(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
  });

  for (let index = 0; index < 20; index += 1) {
    await openContact(alice, 'Bob');
    if (index === 0) await sendText(bob, alice, cara, `B-to-A round ${index}`);
    await sendText(alice, bob, cara, `A-to-B round ${index}`);
    await openContact(alice, 'Cara');
    if (index === 0) await sendText(cara, alice, bob, `C-to-A round ${index}`);
    await sendText(alice, cara, bob, `A-to-C round ${index}`);
  }

  await openContact(alice, 'Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'A-to-B round 19' })).toBeVisible();
  await openContact(alice, 'Cara');
  await expect(alice.locator('.message-text').filter({ hasText: 'A-to-C round 19' })).toBeVisible();
  await alice.reload();
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await alice.locator('input[type=password]').fill(passphrase);
  await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(alice.locator('.conversation-row')).toHaveCount(2, { timeout: 30000 });
  await openContact(alice, 'Bob');
  await sendText(alice, bob, cara, 'A-to-B after refresh');

  const jpeg = jpeg20KiB(); expect(jpeg).toHaveLength(20 * 1024);
  await openContact(alice, 'Cara');
  await fileTransfer(alice, cara, jpeg, testInfo.outputPath('20k-alice-to-cara.jpg'));
  await openContact(alice, 'Bob');
  await fileTransfer(bob, alice, jpeg, testInfo.outputPath('20k-bob-to-alice.jpg'));
  await openContact(alice, 'Cara');
  await fileTransfer(cara, alice, jpeg, testInfo.outputPath('20k-cara-to-alice.jpg'));
  await openContact(alice, 'Bob');
  await fileTransfer(alice, bob, jpeg, testInfo.outputPath('20k-alice-to-bob.jpg'));

  const decline = async (caller: Page, receiver: Page) => {
    await caller.getByRole('button', { name: 'Calls', exact: true }).click();
    await caller.getByRole('button', { name: 'Start audio call', exact: true }).click();
    await receiver.getByRole('button', { name: 'Decline call', exact: true }).click();
    await expect(caller.locator('.call-info')).not.toBeVisible();
    await expect(receiver.locator('.call-info')).not.toBeVisible();
  };
  await openContact(alice, 'Bob'); await decline(alice, bob);
  await openContact(alice, 'Cara'); await decline(alice, cara);
  await openContact(alice, 'Bob'); await decline(alice, bob);

  await a.close(); await b.close(); await c.close();
});
