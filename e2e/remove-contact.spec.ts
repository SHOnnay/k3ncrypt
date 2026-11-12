import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { connectedPair } from './usabilityHelpers';
import { fsUrl } from './fsUrl';

/**
 * Remove contact [two-browser E2E]. Needs the relay in its production routing mode:
 *   PLAYWRIGHT_DURABLE_ROUTING=true npx playwright test e2e/remove-contact.spec.ts --project=chromium
 */
const storageModule = `${fsUrl(resolve('service/src/storage/secureVault.ts'))}`;
const persistenceModule = `${fsUrl(resolve('service/src/storage/persistence.ts'))}`;
const passphrase = 'alpha-family-existing-account-2026';
const revoke = (page: Page) => page.waitForResponse((response) => response.request().method() === 'DELETE' && /\/api\/chat-link\/[^/]+\/routing\/[^/]+$/.test(new URL(response.url()).pathname), { timeout: 30_000 });
async function removeFromHeader(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.chat-more-menu > summary').click();
  await page.getByRole('button', { name: 'Remove contact', exact: true }).click();
}
async function unlock(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Contacts', exact: true })).toBeEnabled();
}
/** What the encrypted vault still holds about removed chats. */
async function vaultState(page: Page) {
  return page.evaluate(async ({ storageModule, persistenceModule, passphrase }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
    const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
    try {
      const json = async (id: string) => { const bytes = await vault.read('product-session', id); return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : []; };
      const removed = await json('conversation-removals') as string[];
      const leftovers: string[] = [];
      for (const room of removed) for (const type of ['product-messages', 'vodozemac-session', 'conversation-protocol', 'modern-outbox']) if (await vault.read(type, room)) leftovers.push(type);
      return { removed: removed.length, saved: ((await json('conversations')) as { roomId: string }[]).filter(item => removed.includes(item.roomId)).length, outbox: (await json('removal-outbox')).length, leftovers };
    } finally { vault.lock(); }
  }, { storageModule, persistenceModule, passphrase });
}

test.describe('remove contact', () => {
  test.skip(process.env.PLAYWRIGHT_DURABLE_ROUTING !== 'true', 'Requires the relay in durable routing mode (PLAYWRIGHT_DURABLE_ROUTING=true)');

  test('removing a contact purges the chat, tells the relay, and the other person only ever sees "Sent"', async ({ browser }) => {
    test.setTimeout(120_000);
    const { a, b, alice, bob } = await connectedPair(browser);
    try {
      await alice.locator('#msg-input').fill('Before removal'); await alice.locator('#send-btn').click();
      await expect(bob.locator('#messages-area')).toContainText('Before removal');
      const confirmed = revoke(bob);
      await removeFromHeader(bob);
      expect((await confirmed).status()).toBe(200);
      await expect(bob.locator('.conversation-row').filter({ hasText: 'Alice' })).toHaveCount(0);
      await expect(bob.locator('.chat-header')).toHaveCount(0);
      await expect(bob.getByTestId('removal-pending')).toHaveCount(0);

      // The removed person is not told: the message is accepted by the relay and never delivered.
      await alice.locator('#msg-input').fill('After removal'); await alice.locator('#send-btn').click();
      const sent = alice.locator('.message.sent').filter({ hasText: 'After removal' });
      await expect(sent.locator('.message-delivery-details > summary')).toHaveText('Sent', { timeout: 20_000 });
      await alice.waitForTimeout(6_000);
      await expect(sent.locator('.message-delivery-details > summary')).toHaveText('Sent');
      await expect(alice.locator('.chat-header')).toContainText('Bob');

      await unlock(bob);
      await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
      await expect(bob.locator('.workspace-contact').filter({ hasText: 'Alice' })).toHaveCount(0);
      await expect(bob.locator('body')).not.toContainText('After removal');
      expect(await vaultState(bob)).toEqual({ removed: 1, saved: 0, outbox: 0, leftovers: [] });

      // Alice reconnects and still sees an ordinary chat with someone who is not answering.
      await unlock(alice);
      await expect(alice.locator('.conversation-row').filter({ hasText: 'Bob' })).toHaveCount(1);
    } finally { await a.close(); await b.close(); }
  });

  test('a removal made while the relay is unreachable stays removed and is finished later', async ({ browser }) => {
    test.setTimeout(120_000);
    const { a, b, bob } = await connectedPair(browser);
    try {
      await bob.route('**/api/chat-link/*/routing/*', route => route.request().method() === 'DELETE' ? route.abort() : route.continue());
      await removeFromHeader(bob);
      await expect(bob.locator('.conversation-row').filter({ hasText: 'Alice' })).toHaveCount(0);
      await expect(bob.getByTestId('removal-pending')).toBeVisible();
      await unlock(bob);
      await expect(bob.locator('.conversation-row').filter({ hasText: 'Alice' })).toHaveCount(0);
      await expect(bob.getByTestId('removal-pending')).toBeVisible();
      expect(await vaultState(bob)).toEqual({ removed: 1, saved: 0, outbox: 1, leftovers: [] });
      await unlock(bob);
      await bob.unroute('**/api/chat-link/*/routing/*');
      const confirmed = revoke(bob);
      await bob.evaluate(() => window.dispatchEvent(new Event('online')));
      expect((await confirmed).status()).toBe(200);
      await expect(bob.getByTestId('removal-pending')).toHaveCount(0);
    } finally { await a.close(); await b.close(); }
  });
});
