import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

/**
 * Calling someone whose app is closed [two-browser E2E]. No push is sent here (the relay switch is off in tests):
 * this covers the caller side — the content-free wake request, waiting, cancel, and the invite after the contact returns.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const passphrase = 'alpha-family-existing-account-2026';
// Production runs the multiplexed relay for checked contacts, so this spec must pass on both transports:
//   PLAYWRIGHT_MUX_STAGE1=true npx playwright test e2e/call-wake.spec.ts
const MUX = process.env.PLAYWRIGHT_MUX_STAGE1 === 'true';
const JOIN = ['chat-join', 'mux-subscribe'], WAKE = ['call-wake', 'mux-call-wake'], SIGNAL = ['webrtc-signal', 'mux-send-signal'];
const WAKE_KEYS = MUX ? ['deviceAuthorizationProof', 'kind', 'proofNonce', 'proofOperation', 'roomId', 'version', 'wakeId']
  : ['deviceAuthorizationProof', 'kind', 'proofNonce', 'proofOperation', 'recipientRoutingId', 'version', 'wakeId'];
/** A message each way gives the room the established session the multiplexed transport requires. */
async function warmUp(alice: Page, bob: Page) {
  for (const [from, to, text] of [[alice, bob, 'warm up one'], [bob, alice, 'warm up two']] as const) {
    await from.locator('#msg-input').fill(text); await from.locator('#send-btn').click();
    await expect(to.locator('#messages-area')).toContainText(text, { timeout: 30_000 });
  }
}
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
    await warmUp(alice, bob);
    const events = sentEvents(alice);
    await comeBack(alice);
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await bob.goto('about:blank');
    await expect.poll(() => events.some(([name]) => JOIN.includes(name)), { timeout: 30_000 }).toBe(true);
    await alice.waitForTimeout(1_500);

    await startAudioCall(alice);
    await expect(alice.locator('#call-status')).toHaveText('Calling… their phone may need to wake', { timeout: 15_000 });
    const wakes = events.filter(([name]) => WAKE.includes(name));
    expect(wakes).toHaveLength(1);
    const ring = wakes[0][1];
    expect(Object.keys(ring).sort()).toEqual(WAKE_KEYS);
    expect(wakes[0][0]).toBe(MUX ? 'mux-call-wake' : 'call-wake');
    expect(ring).toMatchObject({ version: 1, kind: 'ring', proofOperation: 'relay:signal' });
    expect(String(ring.wakeId)).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing about the call itself has been sent yet.
    expect(events.filter(([name]) => SIGNAL.includes(name))).toHaveLength(0);

    await comeBack(bob);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
    expect(events.filter(([name]) => SIGNAL.includes(name)).length).toBeGreaterThan(0);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).click();
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 60_000 });
    await alice.getByRole('button', { name: 'End call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible({ timeout: 20_000 });
  } finally { await a.close(); await b.close(); }
});

// Reproduces the 2026-11-15 phone failure: the wake answer never arrives (so the caller cannot know the contact is away),
// the invite goes out at once and is lost, and the contact comes back later. The call must still ring there.
test('an invite sent while the contact was away is re-sent when they come back, and the call connects', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    await warmUp(alice, bob);
    // Swallow Alice's wake requests (never acknowledged), as when the relay answers too slowly.
    let swallowed = 0;
    await alice.routeWebSocket(/\/socket\.io\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        if (typeof message === 'string' && /^42\d*\["(mux-)?call-wake"/.test(message)) { swallowed += 1; return; }
        server.send(message);
      });
      server.onMessage((message) => ws.send(message));
    });
    const events = sentEvents(alice);
    await comeBack(alice);
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await bob.goto('about:blank');
    await alice.waitForTimeout(2_000);

    await startAudioCall(alice);
    await expect.poll(() => swallowed, { timeout: 15_000 }).toBeGreaterThan(0);
    // Unknown presence never delays a call: the invite goes out now, and nobody receives it.
    await expect.poll(() => events.filter(([name]) => SIGNAL.includes(name)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const firstSends = events.filter(([name]) => SIGNAL.includes(name)).length;
    await alice.waitForTimeout(3_000);

    if (process.env.CALL_WAKE_DEBUG) console.log('BEFORE BOB', await alice.locator('#call-status').innerText().catch(() => 'none'), firstSends);
    await comeBack(bob);
    if (process.env.CALL_WAKE_DEBUG) setTimeout(async () => console.log('AFTER BOB', await alice.locator('#call-status').innerText().catch(() => 'none'), events.map(([n]) => n).filter((n) => !/message|replay|delivered|received/.test(n)).join(',')), 15_000);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 45_000 });
    expect(events.filter(([name]) => SIGNAL.includes(name)).length).toBeGreaterThan(firstSends);
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
    await warmUp(alice, bob);
    const events = sentEvents(alice);
    await comeBack(alice);
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await bob.goto('about:blank');
    await expect.poll(() => events.some(([name]) => JOIN.includes(name)), { timeout: 30_000 }).toBe(true);
    await alice.waitForTimeout(1_500);

    await startAudioCall(alice);
    await expect(alice.locator('#call-status')).toHaveText('Calling… their phone may need to wake', { timeout: 15_000 });
    await alice.getByRole('button', { name: 'Cancel call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible({ timeout: 10_000 });
    await expect.poll(() => events.filter(([name]) => WAKE.includes(name)).length, { timeout: 10_000 }).toBe(2);
    const [ring, cancel] = events.filter(([name]) => WAKE.includes(name)).map(([, payload]) => payload);
    expect(cancel).toMatchObject({ kind: 'cancel', wakeId: ring.wakeId });
    expect(events.filter(([name]) => SIGNAL.includes(name))).toHaveLength(0);

    // Bob returns later: no call is waiting for him, and Alice can call again straight away.
    await comeBack(bob);
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await expect(bob.getByRole('button', { name: 'Accept call', exact: true })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Calls', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Start audio call', exact: true })).toBeEnabled();
  } finally { await a.close(); await b.close(); }
});
