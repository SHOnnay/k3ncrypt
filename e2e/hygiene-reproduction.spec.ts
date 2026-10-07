import { test, expect } from '@playwright/test';
import { create } from './usabilityHelpers';
test('fresh accounts, refresh and browser reopen have zero chats; unaccepted invitation remains hidden', async ({ browser }) => {
  test.setTimeout(120000);
  for (const name of ['First device', 'Second device']) {
    const context = await browser.newContext(); const page = await context.newPage();
    await create(page, name);
    await expect(page.locator('.conversation-row')).toHaveCount(0);
    await expect(page.getByText('Unavailable conversations', { exact: true })).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
    await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(page.locator('.conversation-row')).toHaveCount(0);
    const state = await context.storageState({ indexedDB: true }); await context.close();
    const reopenedBrowser = await browser.browserType().launch(); const reopened = await reopenedBrowser.newContext({ storageState: state }); const restored = await reopened.newPage();
    await restored.goto('/'); await restored.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await restored.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await restored.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(restored.locator('.conversation-row')).toHaveCount(0); await reopenedBrowser.close();
  }
});

test('expired pending invitation stays quarantined on restore', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage(); await create(page, 'Expired invitation');
  await page.route('**/api/chat-link/status/*', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"state":"EXPIRED"}' }));
  await page.reload(); await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(0); await expect(page.getByText('Unavailable conversations', { exact: true })).toBeVisible(); await context.close();
});
