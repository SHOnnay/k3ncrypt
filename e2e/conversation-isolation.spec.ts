import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { create, invite, connectedPair } from './usabilityHelpers';
const passphrase = 'alpha-family-existing-account-2026';
async function fixture(page: Page, change: 'malformed' | 'missing-session', label = 'Bob') {
  await page.evaluate(async ({ vaultUrl, persistenceUrl, change, label, passphrase }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ vaultUrl);
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceUrl);
    const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
    const data = await vault.read('product-session', 'conversations');
    const entries = JSON.parse(new TextDecoder().decode(data));
    if (change === 'malformed') {
      entries.push({ unavailable: true });
      await vault.write('product-session', 'conversations', new TextEncoder().encode(JSON.stringify(entries)).buffer);
    } else {
      const target = entries.find((item: { remoteDisplayName?: string; label: string; roomId: string }) => item.label === label) ?? entries.find((item: { remoteAddress?: string }) => item.remoteAddress);
      if (!target) throw new Error('Fixture relationship unavailable.');
      await vault.delete('vodozemac-session', target.roomId);
    }
    vault.lock();
  }, { vaultUrl: '/@fs' + resolve('service/src/storage/secureVault.ts'), persistenceUrl: '/@fs' + resolve('service/src/storage/persistence.ts'), change, label, passphrase });
}
async function join(page: Page, link: string) {
  await page.locator('.new-conversation').click(); await page.getByRole('button', { name: 'I have an invitation' }).click();
  await page.locator('#channel-hash').fill(link); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#channel-hash')).not.toBeVisible();
}
test('accepted relationships are unique; corrupt candidate does not poison another contact or sending', async ({ browser }) => {
  test.setTimeout(240000); const { a, b, alice, bob } = await connectedPair(browser);
  await expect(alice.locator('.conversation-row')).toHaveCount(1); await expect(bob.locator('.conversation-row')).toHaveCount(1);
  const c = await browser.newContext(); const cara = await c.newPage(); await create(cara, 'Cara');
  const link = await invite(alice); await join(cara, link);
  await expect(alice.locator('.chat-header')).toContainText('Cara', { timeout: 30000 });
  await expect(alice.locator('.conversation-row')).toHaveCount(2);
  await join(cara, link); await expect(cara.locator('.conversation-row')).toHaveCount(1);
  // Nickname makes the fixture selector independent of encrypted claimed profile.
  await alice.getByRole('button', { name: 'Contacts', exact: true }).click();
  alice.once('dialog', dialog => dialog.accept('Bob'));
  await alice.getByRole('button', { name: 'Edit nickname for Private contact' }).last().click();
  await alice.getByRole('button', { name: 'Chats', exact: true }).click();
  await alice.route('**/api/chat-link/*/prekeys/*', route => route.abort('failed'));
  await alice.locator('.conversation-row').filter({ hasText: 'Bob' }).click();
  await expect(alice.locator('.app-error')).toContainText('could not be opened');
  await expect(alice.locator('.chat-header')).toContainText('Cara');
  await alice.unroute('**/api/chat-link/*/prekeys/*');
  await fixture(alice, 'missing-session');
  await alice.locator('.conversation-row').filter({ hasText: 'Bob' }).click();
  await expect(alice.locator('.app-error')).toContainText('could not be opened');
  await expect(alice.locator('.chat-header')).toContainText('Cara');
  await alice.locator('.chat-footer input[type=text], .chat-footer textarea').fill('Still connected after unavailable selection');
  await alice.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(cara.locator('.message-text').filter({ hasText: 'Still connected after unavailable selection' })).toBeVisible({ timeout: 30000 });
  await fixture(alice, 'malformed');
  await alice.reload(); await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await alice.locator('input[type=password]').fill(passphrase); await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(alice.locator('.conversation-row')).toHaveCount(1); await expect(alice.locator('.chat-header')).toContainText('Cara');
  await alice.getByText('Unavailable conversations', { exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Cara');
  await a.close(); await b.close(); await c.close();
});
