import { test, expect, type Page } from '@playwright/test';
const passphrase = 'alpha-family-existing-account-2026';
async function create(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#show-create-account').click();
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill(name);
  await page.locator('#local-passphrase').fill(passphrase);
  await page.locator('#local-passphrase-confirm').fill(passphrase);
  await page.getByRole('button', { name: 'Create secure account' }).click();
  await expect(page.getByRole('textbox', { name: 'Private invitation' })).toHaveValue(/#modern=/);
  await page.getByRole('button', { name: 'Continue to your chats' }).click();
}
async function security(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
}
async function ownIdentity(page: Page): Promise<string> {
  await security(page);
  await expect(page.locator('.verification-security-details')).toHaveCount(1);
  await page.locator('.verification-security-details summary').click();
  const qr = await page.getByRole('textbox', { name: 'Your verification QR payload', exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close settings' }).click();
  return JSON.parse(qr).fingerprint as string;
}
async function invite(page: Page): Promise<string> {
  await page.locator('.new-conversation').click();
  await page.locator('#show-create-account').click();
  await expect(page.locator('#local-passphrase')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Private invitation' });
  await expect(input).toHaveValue(/#modern=/);
  const link = await input.inputValue();
  await page.getByRole('button', { name: 'Continue to your chats' }).click();
  return link;
}

test('independent accounts connect, exchange claimed names, explicitly verify, and retain identity', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await browser.newContext(); const b = await browser.newContext();
  const alice = await a.newPage(); const bob = await b.newPage();
  alice.setDefaultTimeout(10000); bob.setDefaultTimeout(10000);
  const outbound: string[] = []; const external: string[] = [];
  for (const page of [alice, bob]) {
    page.on('request', (request) => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') external.push(url.hostname); if (request.method() !== 'GET') outbound.push(request.postData() ?? ''); });
    page.on('websocket', (socket) => socket.on('framesent', (frame) => outbound.push(String(frame.payload))));
  }
  await create(alice, 'Alpha Alice'); await create(bob, 'Alpha Bob');
  const aliceIdentity = await ownIdentity(alice); const bobIdentity = await ownIdentity(bob);
  const first = await invite(alice);
  // A locked existing account accepts the pending URL invitation after unlocking.
  await bob.goto(first); await bob.reload();
  await bob.getByRole('button', { name: 'Unlock and accept invitation' }).click();
  await expect(bob.locator('#channel-hash')).toHaveValue(/modern=/);
  await bob.locator('input[type=password]').fill(passphrase);
  await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(bob.locator('#channel-hash')).not.toBeVisible();
  await expect(bob.locator('.chat-header')).toContainText('Alpha Alice', { timeout: 20000 });
  await expect(alice.locator('.chat-header')).toContainText('Alpha Bob', { timeout: 20000 });
  expect(await ownIdentity(bob)).toBe(bobIdentity);
  expect(await ownIdentity(alice)).toBe(aliceIdentity);
  // The second relationship uses both unlocked accounts and asks for no new passphrase.
  const second = await invite(alice);
  await bob.locator('.new-conversation').click();
  await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(second);
  await expect(bob.locator('input[type=password]')).toHaveCount(0);
  await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(bob.locator('#channel-hash')).not.toBeVisible();
  await expect(bob.locator('.chat-header')).toContainText('Alpha Alice');
  expect(await ownIdentity(bob)).toBe(bobIdentity);
  const contactsBefore = await bob.locator('.conversation-row').count();
  await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(second); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(bob.locator('#channel-hash')).not.toBeVisible();
  await expect(bob.locator('.chat-header')).toContainText('Alpha Alice');
  expect(await bob.locator('.conversation-row').count()).toBe(contactsBefore);
  await alice.locator('.chat-footer').getByRole('button', { name: 'Verify Alpha Bob' }).click();
  await bob.locator('.chat-footer').getByRole('button', { name: 'Verify Alpha Alice' }).click();
  const aliceCode = alice.getByLabel('Comparison security code');
  const bobCode = bob.getByLabel('Comparison security code');
  await expect(aliceCode).toHaveText(/\d{5}( · \d{5}){5}/);
  await expect(bobCode).toHaveText(await aliceCode.textContent() ?? '');
  await alice.locator('.verification-security-details summary').click();
  await bob.locator('.verification-security-details summary').click();
  const aliceQr = await alice.getByLabel('Your verification QR payload', { exact: true }).inputValue();
  const bobQr = await bob.getByLabel('Your verification QR payload', { exact: true }).inputValue();
  const mark = bob.getByRole('button', { name: 'Mark as verified', exact: true });
  await bob.getByLabel('Contact verification QR payload', { exact: true }).fill(bobQr);
  await bob.getByRole('button', { name: 'Check shared QR payload' }).click();
  await expect(mark).toBeDisabled();
  await expect(bob.locator('.verification-view')).toContainText('This QR does not match');
  await bob.getByLabel('Contact verification QR payload', { exact: true }).fill(aliceQr);
  await bob.getByRole('button', { name: 'Check shared QR payload' }).click();
  await expect(mark).toBeEnabled();
  await expect(bob.locator('.verification-view')).toContainText('Unverified');
  await mark.click(); await bob.getByRole('button', { name: 'Back to chat' }).click();
  await expect(bob.locator('.chat-header')).toContainText('Verified');
  await alice.getByRole('button', { name: 'Close settings' }).click();
  await alice.getByRole('button', { name: 'Open settings' }).click(); await alice.getByRole('button', { name: 'Profile' }).click();
  await alice.locator('#local-profile-name').fill('Alice Updated'); await alice.getByRole('button', { name: 'Save display name' }).click();
  await expect(bob.locator('.chat-header')).toContainText('Alice Updated');
  await expect(bob.locator('.chat-header')).toContainText('Verified');
  await alice.getByRole('button', { name: 'Close settings' }).click();
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  bob.once('dialog', async (dialog) => { await dialog.accept('My sister'); });
  await bob.locator('.workspace-contact__edit').first().click();
  await bob.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(bob.locator('.chat-header')).toContainText('My sister');
  await alice.getByRole('button', { name: 'Open settings' }).click(); await alice.getByRole('button', { name: 'Profile' }).click();
  await alice.locator('#local-profile-name').fill('Alice Again'); await alice.getByRole('button', { name: 'Save display name' }).click();
  await expect(bob.locator('.chat-header')).toContainText('My sister');
  // Reopen checks that trust and the existing local account survive unlocking.
  await bob.reload(); await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await bob.locator('input[type=password]').fill(passphrase); await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(bob.locator('.chat-header')).toContainText('Verified');
  expect(await ownIdentity(bob)).toBe(bobIdentity);
  expect(external).toEqual([]);
  expect(outbound.join('')).not.toMatch(/Alpha Alice|Alpha Bob|Alice Updated|Alice Again|My sister/);
  await a.close(); await b.close();
});
