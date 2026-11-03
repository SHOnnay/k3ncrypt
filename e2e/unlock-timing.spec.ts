import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A11 (opt-in: UNLOCK_TIMING=true). Measures how long the unlock screen waits, with a fixed delay
// on every HTTP request to stand in for the production round trip. Prints one JSON line per round.
const latencyMs = Number(process.env.UNLOCK_LATENCY_MS ?? 110);
const rounds = Number(process.env.UNLOCK_ROUNDS ?? 3);

test('unlock timing with simulated round-trip latency', async ({ browser }) => {
  test.skip(process.env.UNLOCK_TIMING !== 'true', 'Opt-in: UNLOCK_TIMING=true');
  test.setTimeout(300_000);
  const { a, alice } = await connectedPair(browser);
  await a.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document' && !/\/(api|socket\.io)\//.test(route.request().url())) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, latencyMs)); await route.continue();
  });
  for (let round = 1; round <= rounds; round += 1) {
    await alice.reload();
    await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
    const paths: string[] = []; let requests = 0; let requestsWhileWaiting = 0; let waiting = true;
    const count = (request: import('@playwright/test').Request) => { if (/\/(api|socket\.io)\//.test(request.url())) { requests += 1; paths.push(`+${Date.now() - started} ${request.method()} ${new URL(request.url()).pathname.replace(/[A-Za-z0-9_-]{16,}/g, ':id')}${new URL(request.url()).searchParams.get('transport') ? `?${new URL(request.url()).searchParams.get('transport')}` : ''}${request.url().includes('device-trust/proof') ? ` ${String((request.postDataJSON() as { operation?: string } | null)?.operation)}` : ''}`); if (waiting) requestsWhileWaiting += 1; } };
    let started = Date.now();
    alice.on('request', count);
    started = Date.now();
    await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(alice.locator('input[type=password]')).toHaveCount(0, { timeout: 60_000 });
    const unlockScreenMs = Date.now() - started; waiting = false;
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 60_000 });
    await expect(alice.getByRole('button', { name: 'Send message', exact: true })).toBeAttached({ timeout: 60_000 });
    await expect(alice.locator('.chat-footer textarea')).toBeEnabled({ timeout: 60_000 });
    const connectedMs = Date.now() - started;
    await alice.waitForTimeout(1_000);
    alice.off('request', count);
    console.log(JSON.stringify({ round, latencyMs, unlockScreenMs, connectedMs, requestsWhileWaiting, requestsTotal: requests, ...(process.env.UNLOCK_PATHS === 'true' ? { paths } : {}) }));
  }
});
