import { test, expect, type Page } from '@playwright/test';
import { create, invite } from './usabilityHelpers';

const passphrase = 'alpha-family-existing-account-2026';
// Bug A decision: own pending invitations live only on the Invite someone screen.
const inviteScreen = async (page: Page) => {
  // Setup completion hides the overlay asynchronously; retry until the Invite screen is showing.
  await expect(async () => {
    await page.locator('.new-conversation').click();
    await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return page.getByRole('region', { name: 'Your invitations' });
};

test('own invitations can be hidden and shown again on the Invite screen across refresh and unlock', async ({ page }) => {
  test.setTimeout(90_000);
  await create(page, 'Alice');
  await invite(page);
  await expect(page.getByRole('region', { name: 'Conversations' })).not.toContainText('Your invitation');
  const own = await inviteScreen(page);
  const rows = own.locator('.own-invitation-row');
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await expect(rows.first()).toContainText('Your invitation ·');
  await expect(rows.first()).toContainText(/Expires/);
  await rows.first().getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(own.getByRole('button', { name: 'Hide', exact: true })).toHaveCount(before - 1);
  await expect(own.getByText('Hidden on this device (1)', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  const again = await inviteScreen(page);
  await again.getByText('Hidden on this device (1)', { exact: true }).click();
  await again.getByRole('button', { name: 'Show again', exact: true }).click();
  await expect(again.getByRole('button', { name: 'Hide', exact: true })).toHaveCount(before);
});
