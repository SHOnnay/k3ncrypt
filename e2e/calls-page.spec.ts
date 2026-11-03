import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A8. Invariant: the Calls page lists calls from local encrypted history and Call back starts a call in the same mode.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

test('Calls page shows recent calls and Call back rings the contact', async ({ browser }) => {
  test.setTimeout(240_000);
  const { alice, bob } = await connectedPair(browser);
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await expect(alice.getByText('No calls yet', { exact: false })).toBeVisible();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  await alice.waitForTimeout(2_000);
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(alice.locator('.call-info')).not.toBeVisible({ timeout: 15_000 });

  await alice.getByRole('button', { name: 'Chats', exact: true }).click();
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  const row = alice.locator('.call-history-row').filter({ hasText: 'Bob' }).first();
  await expect(row).toContainText('Outgoing voice call', { timeout: 15_000 });
  await expect(row).toContainText(/0:0[1-9]|0:[1-5]\d/);

  await row.getByRole('button', { name: 'Call back Bob (voice)', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
});
