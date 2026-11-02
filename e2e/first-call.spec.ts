import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// First-call-only failure from physical testing: every case uses a fresh account pair,
// so this is the first call and first media setup on both sides.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

const instrument = async (context: BrowserContext, micDelayMs: number) => context.addInitScript((delay: number) => {
  const native = window.RTCPeerConnection;
  const peers: RTCPeerConnection[] = [];
  (globalThis as unknown as { __peers: RTCPeerConnection[] }).__peers = peers;
  window.RTCPeerConnection = new Proxy(native, { construct(target, args) { const peer = new target(...(args as [RTCConfiguration])); peers.push(peer); return peer; } });
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => { await new Promise(done => setTimeout(done, delay)); return capture(constraints); };
}, micDelayMs);

const audioBytes = (page: Page) => page.evaluate(async () => {
  const peers = (globalThis as unknown as { __peers: RTCPeerConnection[] }).__peers;
  let received = 0; let sent = 0;
  for (const peer of peers) (await peer.getStats()).forEach((item: { type: string; kind?: string; bytesReceived?: number; bytesSent?: number }) => {
    if (item.type === 'inbound-rtp' && item.kind === 'audio') received += item.bytesReceived ?? 0;
    if (item.type === 'outbound-rtp' && item.kind === 'audio') sent += item.bytesSent ?? 0;
  });
  return { received, sent };
});

for (const [label, delay] of [['granted mic', 0], ['8s mic permission prompt', 8000]] as const) {
  test(`first call on fresh sessions flows audio both ways: ${label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { a, b, alice, bob } = await connectedPair(browser);
    await instrument(a, delay); await instrument(b, delay);
    await alice.reload(); await bob.reload();
    for (const page of [alice, bob]) {
      await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
      await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
      await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
    }
    for (const [page, name] of [[alice, 'Bob'], [bob, 'Alice']] as const) {
      await page.locator('.conversation-row').filter({ hasText: name }).click();
      await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30_000 });
    }
    await bob.getByRole('button', { name: 'Calls', exact: true }).click();
    const start = bob.getByRole('button', { name: 'Start audio call', exact: true });
    await expect(start).toBeEnabled({ timeout: 30_000 }); await start.click();
    await alice.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 40_000 });
    await expect(bob.locator('#call-status')).toHaveText('Connected', { timeout: 40_000 });
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 40_000 });
    await expect.poll(() => audioBytes(alice), { timeout: 15_000 }).toMatchObject({ received: expect.any(Number) });
    await expect.poll(async () => (await audioBytes(alice)).received > 0 && (await audioBytes(bob)).received > 0, { timeout: 15_000 }).toBe(true);
    await a.close(); await b.close();
  });
}
