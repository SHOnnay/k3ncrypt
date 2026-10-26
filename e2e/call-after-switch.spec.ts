import { test, expect, type Page } from '@playwright/test';
import { connectedPair, create, invite } from './usabilityHelpers';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

const verify = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

const openContact = async (page: Page, name: string) => {
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
  });
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await row.click();
  await expect.poll(() => page.locator('html').getAttribute('data-k3ncrypt-conversation-open'), { timeout: 30000 }).toMatch(/^(connected|same-room)$/);
  await expect(row).toHaveClass(/active/);
  try { await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30000 }); }
  catch (error) {
    const active = await page.locator('.conversation-row.active').innerText().catch(() => 'none');
    const failure = await page.locator('.app-error').innerText().catch(() => 'none');
    const header = await page.locator('.chat-header').innerText().catch(() => 'none');
    console.log('SWITCH_SAFE_STATE', `target=${name};active=${active};failure=${failure};header=${header}`);
    throw error;
  }
};

const activeTransport = async (page: Page) => page.evaluate(() =>
  (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => string | undefined }).__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?.());

const installMediaRequestProbe = () => {
  const target = globalThis as typeof globalThis & { __K3NCRYPT_MEDIA_REQUEST_COUNT__?: number; __K3NCRYPT_MEDIA_PROBE_INSTALLED__?: boolean };
  if (target.__K3NCRYPT_MEDIA_PROBE_INSTALLED__ || !navigator.mediaDevices?.getUserMedia) return;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    value: (...args: Parameters<MediaDevices['getUserMedia']>) => {
      target.__K3NCRYPT_MEDIA_REQUEST_COUNT__ = (target.__K3NCRYPT_MEDIA_REQUEST_COUNT__ ?? 0) + 1;
      return original(...args);
    },
  });
  target.__K3NCRYPT_MEDIA_REQUEST_COUNT__ = 0;
  target.__K3NCRYPT_MEDIA_PROBE_INSTALLED__ = true;
};

const reloadUnlocked = async (page: Page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
};

const startAndDecline = async (caller: Page, receiver: Page) => {
  await caller.getByRole('button', { name: 'Calls', exact: true }).click();
  const start = caller.getByRole('button', { name: 'Start audio call', exact: true });
  await expect(start).toBeEnabled(); await start.click();
  await receiver.getByRole('button', { name: 'Decline call', exact: true }).click({ timeout: 20000 });
  await expect(caller.locator('.call-info')).not.toBeVisible();
  await expect(receiver.locator('.call-info')).not.toBeVisible();
};

const enableSafeCallDiagnostics = async (page: Page, output: string[]) => {
  page.on('console', message => {
    const match = message.text().match(/^k3ncrypt-call-(?:failure|transport|negotiation):[a-z-]+$|^k3ncrypt-call-start-failed:[a-z-]+:[a-z-]+$/);
    if (match) output.push(match[0]);
  });
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    const category = path.includes('/device-trust/proof') ? 'device-proof' : path.includes('/prekeys') ? 'prekey' : path.includes('/chat-link/') ? 'room-control' : 'other-api';
    console.log('CALL_SAFE_HTTP', `${response.request().method()}:${category}:${response.status()}:retry=${response.headers()['retry-after'] ?? 'none'}`);
  });
};

test('audio call support follows the selected contact and decline permits a call to the next contact', async ({ browser }) => {
  test.setTimeout(240000);
  const muxEnabled = process.env.PLAYWRIGHT_MUX_STAGE1 === 'true';
  const { a, b, alice, bob } = await connectedPair(browser, muxEnabled);
  if (muxEnabled) {
    await alice.addInitScript(installMediaRequestProbe);
    await bob.addInitScript(installMediaRequestProbe);
    await alice.evaluate(installMediaRequestProbe);
    await bob.evaluate(installMediaRequestProbe);
  }
  const c = await browser.newContext({ permissions: ['microphone', 'camera'] });
  if (muxEnabled) await c.addInitScript(() => { (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  const cara = await c.newPage(); await create(cara, 'Cara');
  const invitation = await invite(alice);
  await cara.locator('.new-conversation').click(); await cara.getByRole('button', { name: 'I have an invitation' }).click();
  await cara.locator('#channel-hash').fill(invitation); await cara.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Cara', { timeout: 30000 });
  await expect(cara.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  await verify(alice); await verify(cara);
  await openContact(alice, 'Bob');
  await bob.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Alice');
  await bob.getByRole('button', { name: 'Send message', exact: true }).click();
  await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Bob');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  await openContact(alice, 'Cara');
  await cara.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Alice');
  await cara.getByRole('button', { name: 'Send message', exact: true }).click();
  await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Cara');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  if (muxEnabled) {
    await reloadUnlocked(alice); await reloadUnlocked(bob); await reloadUnlocked(cara);
    await openContact(alice, 'Bob');
    await openContact(bob, 'Alice');
    await expect.poll(() => activeTransport(alice), { timeout: 30_000 }).toBe('multiplexed');
    await expect.poll(() => activeTransport(bob), { timeout: 30_000 }).toBe('multiplexed');
    // Reconnect after unlock and before the invite to cover the restored
    // selected-room receiver and authenticated signal listener reattachment.
    await alice.evaluate(async () => {
      const hook = (globalThis as typeof globalThis & { __K3NCRYPT_MUX_RECONNECT__?: () => Promise<void> }).__K3NCRYPT_MUX_RECONNECT__;
      if (!hook) throw new Error('Mux reconnect diagnostic is unavailable.');
      await hook();
    });
    await expect.poll(() => alice.evaluate(() => {
      const hook = (globalThis as typeof globalThis & { __K3NCRYPT_MUX_SNAPSHOT__?: () => { connected: boolean; authenticated: boolean; roomSubscriptionCount: number } | undefined }).__K3NCRYPT_MUX_SNAPSHOT__;
      const snapshot = hook?.();
      return Boolean(snapshot?.connected && snapshot.authenticated && snapshot.roomSubscriptionCount >= 2);
    }), { timeout: 30_000 }).toBe(true);
    await bob.getByRole('button', { name: 'Calls', exact: true }).click();
    await bob.getByRole('button', { name: 'Start audio call', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Accept call', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(alice.locator('.call-info')).toHaveCount(1);
    await expect(alice.locator('.call-contact-name')).toHaveText('Bob');
    await expect.poll(() => alice.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_MEDIA_REQUEST_COUNT__?: number }).__K3NCRYPT_MEDIA_REQUEST_COUNT__ ?? 0)).toBe(0);
    await alice.getByRole('button', { name: 'Accept call', exact: true }).click();
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 20_000 });
    await expect(bob.locator('#call-status')).toHaveText('Connected', { timeout: 20_000 });
    await expect.poll(() => alice.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_MEDIA_REQUEST_COUNT__?: number }).__K3NCRYPT_MEDIA_REQUEST_COUNT__ ?? 0)).toBeGreaterThan(0);
    await bob.getByRole('button', { name: 'End call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible();
    await expect(bob.locator('.call-info')).not.toBeVisible();
    // Switch Alice to Carol while Bob calls again. The global incoming UI must
    // remain bound to Bob and decline must not start local media.
    await openContact(alice, 'Cara');
    await bob.getByRole('button', { name: 'Calls', exact: true }).click();
    await bob.getByRole('button', { name: 'Start audio call', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Decline call', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(alice.locator('.call-contact-name')).toHaveText('Bob');
    const mediaRequestsBeforeDecline = await alice.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_MEDIA_REQUEST_COUNT__?: number }).__K3NCRYPT_MEDIA_REQUEST_COUNT__ ?? 0);
    await alice.getByRole('button', { name: 'Decline call', exact: true }).click({ timeout: 30_000 });
    await expect(alice.locator('.call-info')).not.toBeVisible();
    await expect(bob.locator('.call-info')).not.toBeVisible();
    await expect.poll(() => alice.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_MEDIA_REQUEST_COUNT__?: number }).__K3NCRYPT_MEDIA_REQUEST_COUNT__ ?? 0)).toBe(mediaRequestsBeforeDecline);
    await openContact(alice, 'Bob');
  }
  const callDiagnostics: string[] = [];
  await enableSafeCallDiagnostics(alice, callDiagnostics);
  await enableSafeCallDiagnostics(bob, callDiagnostics);
  await enableSafeCallDiagnostics(cara, callDiagnostics);
  await openContact(alice, 'Bob');
  const completedBobCallsBefore = await alice.getByLabel('Local call history').filter({ hasText: /^Voice call/ }).count();
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  const callSetupStartedAt = Date.now();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  await expect(bob.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  console.log('MUX_TIMING', `call-setup-alice-bob elapsedMs=${Date.now() - callSetupStartedAt}`);
  await expect(alice.locator('.call-contact-name')).toHaveText('Bob');
  await expect(alice.locator('#call-status')).toHaveText('Connected');
  if (muxEnabled) {
    // The call overlay is modal. Dispatch the existing navigation handler to
    // exercise a selected-room change while its authenticated call remains on
    // an already-subscribed room; do not bypass or create any room authority.
    await alice.locator('.conversation-row').filter({ hasText: 'Cara' }).dispatchEvent('click');
    await expect(alice.locator('.chat-header')).toContainText('Cara');
    await expect(alice.locator('.call-contact-name')).toHaveText('Bob');
    await expect(alice.getByLabel('Local call history')).toHaveCount(0);
  }
  await bob.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(alice.locator('.call-info')).not.toBeVisible();
  await expect(bob.locator('.call-info')).not.toBeVisible();
  await openContact(alice, 'Cara');
  await expect(alice.getByLabel('Local call history')).toHaveCount(0);
  await openContact(alice, 'Bob');
  await expect(alice.getByLabel('Local call history').filter({ hasText: /^Voice call/ })).toHaveCount(completedBobCallsBefore + 1);
  await openContact(alice, 'Cara');
  if (muxEnabled) await expect.poll(() => activeTransport(alice), { timeout: 30_000 }).toBe('multiplexed');
  await startAndDecline(alice, cara);
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await cara.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 20000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  await expect(cara.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  await expect(alice.locator('.call-contact-name')).toHaveText('Cara');
  await cara.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(alice.locator('.call-info')).not.toBeVisible();
  await expect(cara.locator('.call-info')).not.toBeVisible();
  await openContact(alice, 'Cara');
  await expect(alice.getByLabel('Local call history').filter({ hasText: /^Voice call/ })).toHaveCount(1);
  const observed = async (receiver: Page) => {
    try { await startAndDecline(alice, receiver); }
    catch (error) { console.log('SAFE_CALL_DIAGNOSTICS', callDiagnostics.sort().join(',')); throw error; }
  };
  await openContact(alice, 'Bob'); await observed(bob);
  await openContact(alice, 'Cara'); await observed(cara);
  await openContact(alice, 'Bob'); await observed(bob);
  await a.close(); await b.close(); await c.close();
});
