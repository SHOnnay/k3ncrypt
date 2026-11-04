import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// Part A2 bug 6 (investigation). First video call failed with "Call media could not start", the second worked.
// A first-time permission prompt makes getUserMedia slow; this stands in for it with a delay on the first request.
// Opt-in investigation: FIRST_CALL_DIAG=true (PERMISSION_DELAY_MS, PERMISSION_SIDES, FRESH_SIDES).
test.skip(process.env.FIRST_CALL_DIAG !== 'true', 'Opt-in investigation: FIRST_CALL_DIAG=true');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const delayMs = Number(process.env.PERMISSION_DELAY_MS ?? 5000);

async function slowFirstCapture(page: Page, who: string, log: string[]) {
  page.on('console', (message) => { const text = message.text(); if (/call|media|ice|capture|k3ncrypt/i.test(text)) log.push(`${who} ${message.type()}: ${text.slice(0, 240)}`); });
  page.on('pageerror', (error) => log.push(`${who} pageerror: ${error.message}`));
  await page.evaluate((delay) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let first = true;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const started = performance.now(); console.info(`k3ncrypt-test getUserMedia start ${JSON.stringify(constraints)}`);
      if (first) { first = false; await new Promise((resolve) => setTimeout(resolve, delay)); }
      try { const stream = await original(constraints); console.info(`k3ncrypt-test getUserMedia ok after ${Math.round(performance.now() - started)} ms`); return stream; }
      catch (error) { console.info(`k3ncrypt-test getUserMedia error ${(error as Error).name}`); throw error; }
    };
  }, delayMs);
}

for (const side of (process.env.PERMISSION_SIDES ?? 'caller,callee').split(',') as ('caller' | 'callee')[]) test(`first video call with a ${delayMs} ms permission prompt on the ${side}`, async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice, bob } = await connectedPair(browser, true);
  const log: string[] = [];
  await slowFirstCapture(side === 'caller' ? alice : bob, side, log);
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start video call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  try {
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 + delayMs });
  } finally {
    for (const [who, page] of [['caller', alice], ['callee', bob]] as const) log.push(`${who} final status=${await page.locator('#call-status').textContent({ timeout: 2_000 }).catch(() => '?')} error=${await page.locator('.call-error').textContent({ timeout: 2_000 }).catch(() => '')}`);
    console.log('FIRST_CALL_LOG\n' + log.join('\n'));
  }
});

for (const who of (process.env.FRESH_SIDES ?? 'both').split(',')) test(`first video call right after unlock (${who} reloaded), no message sent first`, async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice, bob } = await connectedPair(browser, true);
  const log: string[] = [];
  for (const [name, page] of [['caller', alice], ['callee', bob]] as const) {
    page.on('console', (message) => { const text = message.text(); if (/call-stage|call-signal|media|capture|negotiation|stability:cleanup|error/i.test(text)) log.push(`${name} ${message.type()}: ${text.slice(0, 200)}`); });
    if (who === 'both' || who === name) {
      await page.reload(); await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
      await page.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
      await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
    }
  }
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start video call', exact: true }).click();
  try {
    await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  } finally {
    for (const [name, page] of [['caller', alice], ['callee', bob]] as const) log.push(`${name} final status=${await page.locator('#call-status').textContent({ timeout: 2_000 }).catch(() => '?')} error=${await page.locator('.call-error').textContent({ timeout: 2_000 }).catch(() => '')}`);
    console.log('FIRST_CALL_LOG\n' + log.join('\n'));
  }
});
