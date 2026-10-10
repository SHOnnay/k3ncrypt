import { test, expect } from '@playwright/test';
import { create, invite } from './usabilityHelpers';

const passphrase = 'alpha-family-existing-account-2026';

test('pending invitations can be locally dismissed and restored across refresh and unlock', async ({ page }) => {
  test.setTimeout(90_000);
  await create(page, 'Alice');
  await invite(page);
  await expect(page.getByText('Pending Invitations', { exact: true })).toBeVisible();
  const invitation = page.locator('.pending-invitation-row').filter({ has: page.getByRole('button', { name: /Dismiss on this device/ }) }).first();
  await expect(invitation).toBeVisible();
  await expect(invitation).toContainText(/Invitation ·/);
  await expect(invitation).toContainText(/Expires|Expired/);
  const visibleInvitations = page.getByRole('button', { name: 'Dismiss on this device', exact: true });
  const beforeDismiss = await visibleInvitations.count();
  expect(beforeDismiss).toBeGreaterThan(0);
  await invitation.getByRole('button', { name: 'Dismiss on this device' }).click();
  await expect(visibleInvitations).toHaveCount(beforeDismiss - 1);
  await expect(page.getByText('Dismissed on this device (1)', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.getByText('Dismissed on this device (1)', { exact: true })).toBeVisible();
  await page.getByText('Dismissed on this device (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(visibleInvitations).toHaveCount(beforeDismiss);
  await expect(page.locator('.pending-invitation-row').filter({ hasText: /Invitation ·/ }).first()).toContainText(/Expires|Expired/);
});
