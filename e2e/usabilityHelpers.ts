import { expect, type Page } from '@playwright/test';
const passphrase = 'alpha-family-existing-account-2026';
export async function create(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#show-create-account').click();
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill(name);
  await page.locator('#local-passphrase').fill(passphrase);
  await page.locator('#local-passphrase-confirm').fill(passphrase);
  await page.getByRole('button', { name: 'Create secure account' }).click();
  await expect(page.getByRole('textbox', { name: 'Private invitation' })).toHaveValue(/#modern=/);
  await page.getByRole('button', { name: 'Continue to your chats', exact: true }).click();
}
async function security(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
}
export async function ownIdentity(page: Page): Promise<string> {
  await security(page);
  await expect(page.locator('.verification-security-details')).toHaveCount(1);
  await page.locator('.verification-security-details summary').click();
  const qr = await page.getByRole('textbox', { name: 'Your verification QR payload', exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close settings' }).click();
  return JSON.parse(qr).fingerprint as string;
}
export async function invite(page: Page): Promise<string> {
  await page.locator('.new-conversation').click();
  await page.locator('#show-create-account').click();
  await expect(page.locator('#local-passphrase')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Private invitation' });
  await expect(input).toHaveValue(/#modern=/);
  const link = await input.inputValue();
  await page.getByRole('button', { name: 'Continue to your chats', exact: true }).click();
  return link;
}


export async function connectedPair(browser: import('@playwright/test').Browser) {
  const a = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const b = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const alice = await a.newPage(); const bob = await b.newPage();
  await create(alice, 'Alice'); await create(bob, 'Bob');
  const link = await invite(alice);
  await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(link); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(bob.locator('#channel-hash')).not.toBeVisible();
  await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30000 });
  await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  for (const page of [alice, bob]) {
    await security(page); await page.getByRole('button', { name: 'Compare security code', exact: true }).click(); await page.getByRole('button', { name: 'Codes match', exact: true }).click();
    await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  }
  return { a, b, alice, bob };
}
