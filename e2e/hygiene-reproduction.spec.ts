import { test, expect } from '@playwright/test';
import { create } from './usabilityHelpers';
test('fresh accounts keep unaccepted invitations out of chats across refresh and browser reopen', async ({ browser }) => {
  test.setTimeout(120000);
  for (const name of ['First device', 'Second device']) {
    const context = await browser.newContext(); const page = await context.newPage();
    await create(page, name);
    const chats = page.getByRole('region', { name: 'Conversations' });
    await expect(chats.getByText('No saved conversations')).toBeVisible();
    await expect(chats.locator('.conversation-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Open pending invitation / })).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
    await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Conversations' }).locator('.conversation-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Open pending invitation / })).toBeVisible();
    const state = await context.storageState({ indexedDB: true }); await context.close();
    const reopenedBrowser = await browser.browserType().launch(); const reopened = await reopenedBrowser.newContext({ storageState: state }); const restored = await reopened.newPage();
    await restored.goto('/'); await restored.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await restored.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await restored.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(restored.getByRole('region', { name: 'Conversations' }).locator('.conversation-row')).toHaveCount(0);
    await expect(restored.getByRole('button', { name: /^Open pending invitation / })).toBeVisible(); await reopenedBrowser.close();
  }
});

test('expired pending invitation stays quarantined on restore', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage(); await create(page, 'Expired invitation');
  await page.route('**/api/chat-link/status/*', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"state":"EXPIRED"}' }));
  await page.reload(); await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conversations' }).locator('.conversation-row')).toHaveCount(0);
  const unavailable = page.getByRole('region', { name: 'Unavailable Conversations' });
  await expect(unavailable).toContainText('Invitation expired');
  await unavailable.getByText('Technical details', { exact: true }).click();
  await expect(unavailable).toContainText('CONVERSATION_INVITATION_EXPIRED'); await context.close();
});
