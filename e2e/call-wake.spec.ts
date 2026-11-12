import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

/**
 * Calling someone whose app is closed [two-browser E2E]. No push is sent here (the relay switch is off in tests):
 * this covers the caller side — the content-free wake request, waiting, cancel, and the invite after the contact returns.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const passphrase = 'alpha-family-existing-account-2026';
async function startAudioCall(page: Page) {
  await page.getByRole('button', { name: 'Calls', exact: true }).click();
  const button = page.getByRole('button', { name: 'Start audio call', exact: true });
  await expect(button).toBeEnabled(); await button.click();
}
/** Every Socket.IO event this page sends from now on, as [event, payload]. */
function sentEvents(page: Page): [string, Record<string, unknown>][] {
  const events: [string, Record<string, unknown>][] = [];
  const watch = (socket: import('@playwright/test').WebSocket) => socket.on('framesent', (frame) => {
    const text = typeof frame.payload === 'string' ? frame.payload : ''; const start = text.indexOf('[');
    if (!text.startsWith('42') || start < 0) return;
    try { const [name, payload] = JSON.parse(text.slice(start)); if (typeof name === 'string') events.push([name, payload]); } catch { /* not an event frame */ }
  });
  page.on('websocket', (socket) => { watch(socket); socket.on('framereceived', (frame) => { if (process.env.CALL_WAKE_DEBUG && typeof frame.payload === 'string' && frame.payload.startsWith('43')) console.log('ACK', frame.payload.slice(0, 200)); }); });
  if (process.env.CALL_WAKE_DEBUG) setInterval(() => console.log('EVENTS', events.map(([name]) => name).join(',')), 5000).unref();
  return events;
}
async function comeBack(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
}

test('a call to a closed app waits, sends only a content-free wake request, and rings once the contact is back', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    // A fresh socket for Alice, so every frame of the call is observed from the start.
    const events = sentEvents(alice);
    await comeBack(alice);
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await bob.goto('about:blank');
    await expect.poll(() => events.some(([name]) => name === 'chat-join'), { timeout: 30_000 }).toBe(true);
    await alice.waitForTimeout(1_500);

    await startAudioCall(alice);
    await expect(alice.locator('#call-status')).toHaveText('Calling… their phone may need to wake', { timeout: 15_000 });
    const wakes = events.filter(([name]) => name === 'call-wake');
    expect(wakes).toHaveLength(1);
    const ring = wakes[0][1];
    expect(Object.keys(ring).sort()).toEqual(['deviceAuthorizationProof', 'kind', 'proofNonce', 'proofOperation', 'recipientRoutingId', 'version', 'wakeId']);
    expect(ring).toMatchObject({ version: 1, kind: 'ring', proofOperation: 'relay:signal' });
    expect(String(ring.wakeId)).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing about the call itself has been sent yet.
    expect(events.filter(([name]) => name === 'webrtc-signal')).toHaveLength(0);

    await comeBack(bob);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
    expect(events.filter(([name]) => name === 'webrtc-signal').length).toBeGreaterThan(0);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).click();
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 60_000 });
    await alice.getByRole('button', { name: 'End call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible({ timeout: 20_000 });
  } finally { await a.close(); await b.close(); }
});

test('cancelling while waiting sends no invite and withdraws the wake request with the same id', async ({ browser }) => {
  test.setTimeout(120_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    const events = sentEvents(alice);
    await comeBack(alice);
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await bob.goto('about:blank');
    await expect.poll(() => events.some(([name]) => name === 'chat-join'), { timeout: 30_000 }).toBe(true);
    await alice.waitForTimeout(1_500);

    await startAudioCall(alice);
    await expect(alice.locator('#call-status')).toHaveText('Calling… their phone may need to wake', { timeout: 15_000 });
    await alice.getByRole('button', { name: 'Cancel call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible({ timeout: 10_000 });
    await expect.poll(() => events.filter(([name]) => name === 'call-wake').length, { timeout: 10_000 }).toBe(2);
    const [ring, cancel] = events.filter(([name]) => name === 'call-wake').map(([, payload]) => payload);
    expect(cancel).toMatchObject({ kind: 'cancel', wakeId: ring.wakeId });
    expect(events.filter(([name]) => name === 'webrtc-signal')).toHaveLength(0);

    // Bob returns later: no call is waiting for him, and Alice can call again straight away.
    await comeBack(bob);
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await expect(bob.getByRole('button', { name: 'Accept call', exact: true })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Calls', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Start audio call', exact: true })).toBeEnabled();
  } finally { await a.close(); await b.close(); }
});
