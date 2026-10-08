import { test, expect, type Page } from '@playwright/test';
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

test('three verified profiles deliver to Alice background rooms over one real mux socket', async ({ browser }) => {
  test.setTimeout(120_000);
  const { a, b, alice, bob } = await connectedPair(browser, true);
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

  const initialBobMessages = await alice.locator('.message-text').count();
  await expect.poll(() => muxSnapshot(bob), { timeout: 30_000 }).toMatchObject({ authenticated: true, socketCount: 1, roomSubscriptionCount: 1 });
  await expect.poll(() => activeTransport(bob), { timeout: 30_000 }).toBe('multiplexed');
  await expect.poll(() => activeTransport(alice), { timeout: 30_000 }).toBe('multiplexed');
  try { await send(bob, 'Bob is still the visible room'); }
  catch (error) {
    console.log('MUX_SAFE_STATE', JSON.stringify({ senderTransport: await activeTransport(bob), receiverTransport: await activeTransport(alice), sender: await muxSnapshot(bob), receiver: await muxSnapshot(alice) }));
    throw error;
  }
  await expect(alice.locator('.message-text').filter({ hasText: 'Bob is still the visible room' })).toBeVisible({ timeout: 30_000 });
  const afterBobMessages = await alice.locator('.message-text').count();
  expect(afterBobMessages).toBeGreaterThan(initialBobMessages);

  await send(carol, 'Hello from Carol');
  await expect(alice.locator('.chat-header')).toContainText('Bob');
  await expect(alice.locator('.message-text').filter({ hasText: 'Hello from Carol' })).toHaveCount(0);
  await expect(alice.locator('.message-text')).toHaveCount(afterBobMessages);
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
