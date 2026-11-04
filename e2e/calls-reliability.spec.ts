import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// Calls milestone 2. Invariants: a first call on freshly unlocked sessions connects (no lost invite, no endless
// "Ringing…"); an unanswered call ends with "No answer" and a Retry that rings again.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const rounds = Number(process.env.CALL_STRESS_ROUNDS ?? 20);

async function freshUnlock(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
}

for (const direction of ['alice-calls-bob', 'bob-calls-alice'] as const) test(`stress: ${rounds} first video calls on fresh sessions, ${direction}`, async ({ browser }) => {
  test.skip(process.env.CALL_STRESS !== 'true', 'Opt-in stress run: CALL_STRESS=true');
  test.setTimeout(rounds * 60_000);
  const { alice, bob } = await connectedPair(browser);
  const [caller, callee] = direction === 'alice-calls-bob' ? [alice, bob] : [bob, alice];
  const results: string[] = [];
  for (let round = 1; round <= rounds; round++) {
    // Reload order alternates so the callee is sometimes still installing its call receiver when the invite lands.
    if (round % 2) { await freshUnlock(callee); await freshUnlock(caller); } else { await freshUnlock(caller); await freshUnlock(callee); }
    await caller.getByRole('button', { name: 'Calls', exact: true }).click();
    await caller.getByRole('button', { name: 'Start video call', exact: true }).click();
    let outcome = 'connected';
    try {
      await callee.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
      await expect(caller.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
    } catch {
      outcome = `failed: caller=${await caller.locator('#call-status').textContent({ timeout: 1_000 }).catch(() => 'none')} problem=${await caller.evaluate(() => document.querySelector('.call-error')?.textContent ?? '').catch(() => '')}`;
    }
    results.push(`${round}:${outcome}`);
    await caller.getByRole('button', { name: 'End call', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
    await expect(caller.locator('#call-status')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
    await caller.getByRole('button', { name: 'Chats', exact: true }).click().catch(() => undefined);
  }
  console.log('CALL_STRESS', direction, JSON.stringify(results));
  expect(results.filter((item) => !item.endsWith(':connected'))).toEqual([]);
});

test('an unanswered call ends with No answer and Retry rings again', async ({ browser }) => {
  test.setTimeout(240_000);
  const { alice, bob } = await connectedPair(browser);
  // Bob is online but doesn't answer.
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await expect(alice.locator('#call-status')).toHaveText('Ringing...', { timeout: 15_000 });
  await expect(bob.getByRole('button', { name: 'Accept call', exact: true })).toBeVisible({ timeout: 30_000 });
  const outcome = alice.locator('.chat-call-status').filter({ hasText: 'No answer.' });
  await expect(outcome).toContainText('Bob may be offline or have K3NCRYPT closed.', { timeout: 90_000 });
  await bob.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(bob.locator('.chat-call-status')).toContainText('Missed call from Alice.', { timeout: 15_000 });
  await expect(bob.locator('.chat-call-status').getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await outcome.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(alice.locator('#call-status')).toHaveText('Ringing...', { timeout: 15_000 });
  await alice.getByRole('button', { name: 'Cancel call', exact: true }).click();
});
