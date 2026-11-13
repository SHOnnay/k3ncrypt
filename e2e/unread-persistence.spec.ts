import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

/**
 * Unread badges survive a reload and unlock, and clear when the chat is read [two-browser E2E].
 * On web a chat only receives while it is the open one, so "unread" means: it arrived while the tab was in the background.
 */
const passphrase = 'alpha-family-existing-account-2026';
async function unlock(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
}
const setHidden = (page: Page, hidden: boolean) => page.evaluate((value) => {
  sessionStorage.setItem('e2e-hidden', value ? '1' : '0'); document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

test('an unread count is still there after reload and unlock, and is gone after reading', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    // The tab reports "hidden" whenever the test flag is set, including right after a reload.
    await b.addInitScript(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => sessionStorage.getItem('e2e-hidden') === '1' ? 'hidden' : 'visible' }));
    await unlock(bob);
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await setHidden(bob, true);
    for (const text of ['one', 'two', 'three']) {
      await alice.locator('#msg-input').fill(text); await alice.locator('#send-btn').click();
      await expect(bob.locator('#messages-area')).toContainText(text, { timeout: 30_000 });
    }
    const badge = bob.locator('.conversation-row').filter({ hasText: 'Alice' }).locator('.conversation-badge');
    await expect(badge).toHaveText('3');
    await expect(bob).toHaveTitle(/^\(3\) /);

    await unlock(bob);
    await expect(badge).toHaveText('3', { timeout: 30_000 });
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await expect(badge).toHaveText('3');

    await setHidden(bob, false);
    await expect(badge).toHaveCount(0);
    await bob.waitForTimeout(500);
    await unlock(bob);
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await expect(badge).toHaveCount(0);
    await expect(bob).not.toHaveTitle(/^\(\d/);
  } finally { await a.close(); await b.close(); }
});
