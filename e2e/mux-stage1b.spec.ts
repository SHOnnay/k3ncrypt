import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { connectedPair, create, invite } from './usabilityHelpers';

const verify = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

const openContact = async (page: Page, name: string): Promise<void> => {
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30_000 });
};

const reloadUnlocked = async (page: Page): Promise<void> => {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
};

const send = async (sender: Page, text: string): Promise<void> => {
  await sender.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  const sent = sender.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary');
  await expect(sent).toHaveText('Sent', { timeout: 30_000 });
};

const queueWhileRecipientOffline = async (sender: Page, text: string): Promise<void> => {
  await sender.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  const sending = sender.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary');
  await expect(sending).toHaveText('Sending…', { timeout: 10_000 });
};

const muxSnapshot = (page: Page) => page.evaluate(() => {
  const hook = (globalThis as typeof globalThis & { __K3NCRYPT_MUX_SNAPSHOT__?: () => unknown }).__K3NCRYPT_MUX_SNAPSHOT__;
  return hook?.();
});

const activeTransport = (page: Page) => page.evaluate(() => {
  const hook = (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => string | undefined }).__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__;
  return hook?.();
});

const sendMuxFile = async (sender: Page, name: string, bytes: Buffer): Promise<void> => {
  await sender.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  await expect(sender.locator('.media-transfer-status')).toContainText(name, { timeout: 30_000 });
  const status = sender.locator('.media-transfer-status');
  try { await expect(status).toContainText('Sent', { timeout: 30_000 }); }
  catch (error) {
    const retry = sender.getByRole('button', { name: 'Retry', exact: true });
    if (!await retry.isVisible().catch(() => false)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await retry.click();
    await expect(status).toContainText('Sent', { timeout: 30_000 });
  }
};

const downloadMuxFile = async (recipient: Page, name: string, bytes: Buffer, output: string): Promise<void> => {
  const buttons = recipient.getByRole('button', { name: 'Download protected file', exact: true });
  await expect(buttons).not.toHaveCount(0, { timeout: 30_000 });
  await buttons.last().click();
  const save = recipient.getByRole('link', { name: `Save ${name}`, exact: true });
  await expect(save).toBeVisible({ timeout: 30_000 });
  const download = recipient.waitForEvent('download'); await save.click(); const artifact = await download; await artifact.saveAs(output);
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  await recipient.getByRole('button', { name: 'Discard verified output', exact: true }).click();
};

test('three verified profiles deliver to Alice background rooms over one real mux socket', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const { a, b, alice, bob } = await connectedPair(browser, true);
  for (const page of [alice, bob]) {
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/attachments/v2')) console.log('MUX_FILE_HTTP', response.request().method(), response.status(), url.pathname);
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/attachments/v2')) console.log('MUX_FILE_REQUEST_FAILED', request.method(), url.pathname, request.failure()?.errorText ?? 'unknown');
    });
  }
  await send(bob, 'Warm up Bob and Alice');
  await expect(alice.locator('.message-text').filter({ hasText: 'Warm up Bob and Alice' })).toBeVisible();
  const c = await browser.newContext({ permissions: ['microphone', 'camera'] });
  await c.addInitScript(() => { (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  const carol = await c.newPage();
  await create(carol, 'Carol');

  const invitation = await invite(alice);
  await carol.locator('.new-conversation').click();
  await carol.getByRole('button', { name: 'I have an invitation' }).click();
  await carol.locator('#channel-hash').fill(invitation);
  await carol.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Carol', { timeout: 30_000 });
  await expect(carol.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
  await verify(alice);
  await verify(carol);

  // Establish each room’s existing Olm session on both sides before enrolling
  // the room in this development-only mux trial.
  await send(alice, 'Warm up Alice and Carol');
  await expect(carol.locator('.message-text').filter({ hasText: 'Warm up Alice and Carol' })).toBeVisible();
  await send(carol, 'Warm up Carol and Alice');
  await expect(alice.locator('.message-text').filter({ hasText: 'Warm up Carol and Alice' })).toBeVisible();
  await reloadUnlocked(bob);
  await reloadUnlocked(carol);
  await openContact(bob, 'Alice');
  await openContact(carol, 'Alice');
  await openContact(alice, 'Bob');
  await expect.poll(() => muxSnapshot(alice), { timeout: 30_000 }).toMatchObject({
    connected: true, authenticated: true, socketCount: 1, roomSubscriptionCount: 2,
  });
  let renewalProofFailedOnce = false;
  await alice.route('**/api/device-trust/proof', async (route) => {
    const body = route.request().postDataJSON() as { operation?: string };
    if (!renewalProofFailedOnce && body.operation === 'relay:subscribe') {
      renewalProofFailedOnce = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const initialLeaseStartedAt = Date.now();
  await expect.poll(async () => (await muxSnapshot(alice) as { subscriptionRenewals?: number } | undefined)?.subscriptionRenewals ?? 0,
    { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  expect(renewalProofFailedOnce).toBe(true);
  await expect.poll(async () => (await muxSnapshot(alice) as { subscriptionProofAcquisitions?: number } | undefined)?.subscriptionProofAcquisitions ?? 0,
    { timeout: 45_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(async () => (await muxSnapshot(alice) as { subscriptionProofAcquisitions?: number } | undefined)?.subscriptionProofAcquisitions ?? 0,
    { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
  await alice.unroute('**/api/device-trust/proof');
  const proofsBeforeVisibility = (await muxSnapshot(alice) as { subscriptionProofAcquisitions?: number } | undefined)?.subscriptionProofAcquisitions ?? 0;
  await alice.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => muxSnapshot(alice), { timeout: 15_000 }).toMatchObject({ authenticated: true, socketCount: 1, roomSubscriptionCount: 2 });
  expect((await muxSnapshot(alice) as { subscriptionProofAcquisitions?: number } | undefined)?.subscriptionProofAcquisitions).toBe(proofsBeforeVisibility);
  await alice.context().setOffline(true);
  await expect.poll(() => muxSnapshot(alice), { timeout: 10_000 }).toMatchObject({ connected: false, roomSubscriptionCount: 0 });
  await alice.context().setOffline(false);
  await expect.poll(() => muxSnapshot(alice), { timeout: 30_000 }).toMatchObject({ authenticated: true, socketCount: 1, roomSubscriptionCount: 2 });
  await expect.poll(() => Date.now() - initialLeaseStartedAt, { timeout: 110_000, intervals: [500, 1_000, 2_000] }).toBeGreaterThanOrEqual(95_000);

  const initialBobMessages = await alice.locator('.message-text').count();
  await expect.poll(() => muxSnapshot(bob), { timeout: 30_000 }).toMatchObject({ authenticated: true, socketCount: 1, roomSubscriptionCount: 1 });
  await expect.poll(() => activeTransport(bob), { timeout: 30_000 }).toBe('multiplexed');
  await expect.poll(() => activeTransport(carol), { timeout: 30_000 }).toBe('multiplexed');
  await expect.poll(() => activeTransport(alice), { timeout: 30_000 }).toBe('multiplexed');
  try { await send(bob, 'Bob is still the visible room'); }
  catch (error) {
    console.log('MUX_SAFE_STATE', JSON.stringify({ senderTransport: await activeTransport(bob), receiverTransport: await activeTransport(alice), sender: await muxSnapshot(bob), receiver: await muxSnapshot(alice) }));
    throw error;
  }
  await expect(alice.locator('.message-text').filter({ hasText: 'Bob is still the visible room' })).toBeVisible({ timeout: 30_000 });
  const afterBobMessages = await alice.locator('.message-text').count();
  expect(afterBobMessages).toBeGreaterThan(initialBobMessages);

  await send(carol, 'Carol delivered after renewed leases');
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await openContact(alice, 'Carol');
  await expect(alice.locator('.message-text').filter({ hasText: 'Carol delivered after renewed leases' })).toHaveCount(1);
  await openContact(alice, 'Bob');

  const bobFile = Buffer.alloc(20 * 1024, 0x42);
  const bobFileCount = await alice.getByRole('button', { name: 'Download protected file', exact: true }).count();
  await sendMuxFile(bob, 'bob-room-20k.bin', bobFile);
  await expect(alice.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(bobFileCount + 1);
  await downloadMuxFile(alice, 'bob-room-20k.bin', bobFile, testInfo.outputPath('bob-room-20k.bin'));
  const carolButtonsBefore = await alice.getByRole('button', { name: 'Download protected file', exact: true }).count();
  const carolFile = Buffer.alloc(20 * 1024, 0x43);
  await sendMuxFile(carol, 'carol-room-20k.bin', carolFile);
  expect(await alice.getByRole('button', { name: 'Download protected file', exact: true }).count()).toBe(carolButtonsBefore);
  const carolFileSafeBefore = await muxSnapshot(alice) as { receivedFrames?: number; acceptedFrames?: number; retryableFrames?: number } | undefined;
  await openContact(alice, 'Carol');
  const carolFileSafeAfter = await muxSnapshot(alice) as { receivedFrames?: number; acceptedFrames?: number; retryableFrames?: number } | undefined;
  console.log('MUX_CAROL_FILE_SAFE', JSON.stringify({ senderTransport: await activeTransport(carol), before: carolFileSafeBefore, after: carolFileSafeAfter }));
  // Message/media projection is room-scoped, so Carol's room renders its own
  // protected-file button count after switching away from Bob.
  await expect(alice.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(1);
  await downloadMuxFile(alice, 'carol-room-20k.bin', carolFile, testInfo.outputPath('carol-room-20k.bin'));
  await openContact(alice, 'Bob');

  await send(carol, 'Hello from Carol');
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'Hello from Carol' })).toHaveCount(0);
  await expect(alice.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(carolButtonsBefore);
  await openContact(alice, 'Carol');
  await expect(alice.locator('.message-text').filter({ hasText: 'Hello from Carol' })).toHaveCount(1, { timeout: 30_000 });

  await openContact(alice, 'Bob');
  await send(bob, 'Bob interleaved one');
  await send(carol, 'Carol interleaved one');
  await send(bob, 'Bob interleaved two');
  await send(carol, 'Carol interleaved two');
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await openContact(alice, 'Carol');
  await expect(alice.locator('.message-text').filter({ hasText: 'Carol interleaved one' })).toHaveCount(1);
  await expect(alice.locator('.message-text').filter({ hasText: 'Carol interleaved two' })).toHaveCount(1);

  // Reverse the background direction: Alice views Carol while Bob sends.
  await openContact(alice, 'Carol');
  await send(bob, 'Hello from Bob in the background');
  await expect(alice.locator('.chat-header')).toContainText('Carol');
  await expect(alice.locator('.message-text').filter({ hasText: 'Hello from Bob in the background' })).toHaveCount(0);
  await openContact(alice, 'Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'Hello from Bob in the background' })).toHaveCount(1);

  // Queue on the relay while Alice's only device socket is disconnected, then
  // verify both room-specific mailbox replays after unlock/reconnect.
  await alice.reload();
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).waitFor({ timeout: 30_000 });
  await queueWhileRecipientOffline(bob, 'Bob queued during Alice reconnect');
  await queueWhileRecipientOffline(carol, 'Carol queued during Alice reconnect');
  await reloadUnlocked(alice);
  await expect(bob.locator('.message.sent').filter({ hasText: 'Bob queued during Alice reconnect' }).locator('.message-delivery-details summary')).toHaveText('Sent', { timeout: 30_000 });
  await expect(carol.locator('.message.sent').filter({ hasText: 'Carol queued during Alice reconnect' }).locator('.message-delivery-details summary')).toHaveText('Sent', { timeout: 30_000 });
  await openContact(alice, 'Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'Bob queued during Alice reconnect' })).toHaveCount(1);
  await openContact(alice, 'Carol');
  await expect(alice.locator('.message-text').filter({ hasText: 'Carol queued during Alice reconnect' })).toHaveCount(1);

  // Revoking verification in Carol's room terminally rejects that room while
  // the separately verified Bob room remains usable.
  await alice.getByRole('button', { name: 'Open settings' }).click();
  await alice.getByRole('button', { name: 'Security' }).click();
  await alice.locator('.verification-security-details summary').click();
  await alice.getByRole('button', { name: 'Mark unverified', exact: true }).click();
  await alice.getByRole('button', { name: 'Close settings', exact: true }).click();
  await openContact(alice, 'Bob');
  await carol.locator('.chat-footer input[type=text], .chat-footer textarea').fill('Carol after Alice revoked verification');
  await carol.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(carol.locator('.message.sent').filter({ hasText: 'Carol after Alice revoked verification' }).getByRole('button', { name: /Could not confirm/ })).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'Carol after Alice revoked verification' })).toHaveCount(0);
  await send(bob, 'Bob still works after Carol verification revocation');
  await expect(alice.locator('.message-text').filter({ hasText: 'Bob still works after Carol verification revocation' })).toHaveCount(1);

  await a.close(); await b.close(); await c.close();
});
