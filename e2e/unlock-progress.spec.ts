import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A11. Invariants: while unlocking, the screen says which step it is on instead of a silent spinner;
// the unlock screen waits only for local work, so a slow network closes it anyway and the chat connects after.
test('unlock closes after local work and the chat connects in the background', async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice } = await connectedPair(browser);
  await alice.reload();
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await alice.route(/\/api\/chat-link\/[^/]+\/prekeys\/[^/]+$/, async (route) => { await held; await route.continue(); });
  await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  // The network step is held, yet the unlock screen closes and the saved chat shows as opening.
  await expect(alice.locator('input[type=password]')).toHaveCount(0, { timeout: 10_000 });
  await expect(alice.locator('.unlock-progress')).toHaveCount(0);
  await expect(alice.locator('.conversation-row[aria-busy="true"]')).toHaveCount(1);
  release();
  await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
  await expect(alice.locator('.conversation-row[aria-busy="true"]')).toHaveCount(0);
});
