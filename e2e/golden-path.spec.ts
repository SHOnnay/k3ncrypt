import { test, expect, type Page } from '@playwright/test';
import { checkByNumbers, uncheckedPair } from './usabilityHelpers';
import { fsUrl } from './fsUrl';

// M2 release gate: one family's whole path in one run.
// invite -> check both ways -> message -> offline delivery -> security number change.
const passphrase = 'alpha-family-existing-account-2026';
const send = async (page: Page, text: string) => {
  await page.getByRole('textbox', { name: 'Write a message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
};
const unlock = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
};

test('invite, check, message, offline delivery, then a number change pauses files and asks to check again', async ({ browser }) => {
  test.setTimeout(240_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);

  await checkByNumbers(alice); await checkByNumbers(bob);
  await expect(alice.locator('.chat-header')).toContainText('Checked on this device');
  await expect(bob.locator('.chat-header')).toContainText('Checked on this device');

  await send(alice, 'Dinner at 8?');
  await expect(bob.locator('.message-text').filter({ hasText: 'Dinner at 8?' })).toBeVisible({ timeout: 30_000 });
  await send(bob, 'Yes, see you');
  await expect(alice.locator('.message-text').filter({ hasText: 'Yes, see you' })).toBeVisible({ timeout: 30_000 });

  // Offline delivery: Bob's tab is closed while Alice sends; the relay mailbox holds it.
  await bob.close();
  await send(alice, 'Sent while you were away');
  await expect(alice.locator('.message.sent').filter({ hasText: 'Sent while you were away' }).locator('.message-delivery-details summary')).toHaveText(/^(Sent|Delivered)$/, { timeout: 30_000 });
  const bobAgain = await b.newPage();
  await unlock(bobAgain);
  await bobAgain.locator('.conversation-row').filter({ hasText: 'Alice' }).click();
  await expect(bobAgain.locator('.message-text').filter({ hasText: 'Sent while you were away' })).toBeVisible({ timeout: 45_000 });

  // Security number change (injected into Bob's own vault; a real reinstall needs a second device).
  await bobAgain.evaluate(async ({ root, passphrase }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ root + '/service/src/storage/secureVault.ts');
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ root + '/service/src/storage/persistence.ts');
    const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
    try {
      const rooms = JSON.parse(new TextDecoder().decode(await vault.read('product-session', 'conversations')));
      const room = rooms.find((item: { remoteAddress?: string }) => item.remoteAddress);
      const contact = JSON.parse(new TextDecoder().decode(await vault.read('contact-identity', room.remoteAddress)));
      const next = { ...contact, verification: 'unverified', changeStatus: 'changed-pending-review', identityChangedAt: Date.now(),
        pendingIdentity: { identityId: 'K3 HQIO A1J9 DNVI TEHH JHLB EA8F S3_9 HP6_ GVJM OUBY NLG', algorithm: contact.algorithm, publicKey: contact.publicKey } };
      delete next.verifiedAt;
      await vault.write('contact-identity', room.remoteAddress, new TextEncoder().encode(JSON.stringify(next)).buffer);
    } finally { vault.lock(); }
  }, { root: fsUrl(process.cwd()), passphrase });
  await unlock(bobAgain);
  await bobAgain.locator('.conversation-row').first().click();
  await expect(bobAgain.locator('.check-banner--changed')).toContainText('Files and calls are paused until you check again.', { timeout: 30_000 });
  await expect(bobAgain.locator('.chat-header')).toContainText('Security number changed');
  await bobAgain.getByRole('button', { name: 'Calls', exact: true }).click();
  await expect(bobAgain.getByRole('button', { name: 'Start audio call', exact: true })).toBeDisabled();
  await a.close(); await b.close();
});
