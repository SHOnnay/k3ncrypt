import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// Calls milestone 3. Invariants: the connection helper is off by default and explained in plain words; a call
// stuck on "Connecting" offers to turn it on, and the retried call uses the helper's STUN server.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

/** Test-only: records each peer connection's ICE servers and drops remote candidates, so ICE never connects. */
async function stallIce(page: Page) {
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    (window as unknown as { __iceConfigs: string[] }).__iceConfigs = [];
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) { super(config); (window as unknown as { __iceConfigs: string[] }).__iceConfigs.push(JSON.stringify(config?.iceServers ?? [])); }
      addIceCandidate(): Promise<void> { return Promise.resolve(); }
    } as typeof RTCPeerConnection;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
}

test('connection helper: off by default, plain words, one-tap retry from a stuck call', async ({ browser }) => {
  test.setTimeout(240_000);
  const { alice, bob } = await connectedPair(browser);
  await alice.getByRole('button', { name: 'Open settings' }).click();
  await alice.getByRole('button', { name: /^Calls Ringtone/ }).click();
  const toggle = alice.getByRole('checkbox', { name: 'Connection helper' });
  await expect(toggle).not.toBeChecked();
  await expect(alice.locator('.settings-row').filter({ has: toggle })).toContainText('Cloudflare');
  await expect(alice.locator('.settings-row').filter({ has: toggle })).toContainText('sees your IP address only');
  await alice.getByRole('button', { name: 'Close settings' }).click();

  for (const page of [alice, bob]) await stallIce(page);
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect.poll(() => alice.evaluate(() => (window as unknown as { __iceConfigs: string[] }).__iceConfigs.length), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await alice.evaluate(() => (window as unknown as { __iceConfigs: string[] }).__iceConfigs.at(-1))).not.toContain('stun.cloudflare.com');
  const offer = alice.getByRole('button', { name: 'Turn on connection helper', exact: true });
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect.poll(() => alice.evaluate(() => (window as unknown as { __iceConfigs: string[] }).__iceConfigs.at(-1) ?? ''), { timeout: 15_000 }).toContain('stun:stun.cloudflare.com:3478');
  await expect(alice.getByRole('button', { name: 'Turn on connection helper', exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'End call', exact: true }).click().catch(() => undefined);

  await alice.getByRole('button', { name: 'Open settings' }).click();
  await alice.getByRole('button', { name: /^Calls Ringtone/ }).click();
  await expect(alice.getByRole('checkbox', { name: 'Connection helper' })).toBeChecked();
});
