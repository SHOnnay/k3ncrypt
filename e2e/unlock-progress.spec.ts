import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A11. Invariant: while unlocking, the screen says which step it is on instead of a silent spinner.
test('unlock shows plain progress through to the chat', async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice } = await connectedPair(browser);
  await alice.reload();
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  // Slow one network step so the connecting phase is observable on a fast local stack.
  await alice.route(/\/api\/chat-link\/[^/]+\/prekeys\/[^/]+$/, async (route) => { await new Promise((resolve) => setTimeout(resolve, 2_000)); await route.continue(); });
  await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  const progress = alice.locator('.unlock-progress');
  await expect(progress).toContainText('Connecting securely…', { timeout: 10_000 });
  await expect(progress.getByRole('progressbar', { name: 'Step 3 of 3' })).toBeVisible();
  await expect(alice.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
  await expect(progress).toHaveCount(0);
});
