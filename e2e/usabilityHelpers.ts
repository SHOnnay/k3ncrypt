import { expect, type Page } from '@playwright/test';
const passphrase = 'alpha-family-existing-account-2026';
export async function create(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#show-create-account').click();
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill(name);
  await page.locator('#local-passphrase').fill(passphrase);
  await page.locator('#local-passphrase-confirm').fill(passphrase);
  const linkCreated = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link', { timeout: 30_000 });
  const deviceBootstrapped = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/device-trust/bootstrap', { timeout: 30_000 }).catch(() => undefined);
  await page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await linkCreated).status()).toBe(200);
  expect((await deviceBootstrapped)?.status()).toBe(201);
  await expect(page.getByRole('textbox', { name: 'Private invitation' })).toHaveValue(/#(?:invite|modern)=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue to your chats', exact: true }).click();
}
export async function security(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security Your security number and checking contacts', exact: true }).click();
}
export async function ownIdentity(page: Page): Promise<string> {
  await security(page);
  await expect(page.locator('.verification-security-details')).toHaveCount(1);
  await page.locator('.verification-security-details > summary').click();
  const qr = await copyMyCode(page);
  await page.getByRole('button', { name: 'Close settings' }).click();
  return JSON.parse(qr).fingerprint as string;
}
/** Part A2 bug 4: the raw code is no longer shown; "Copy my code" puts it on the clipboard. More options must be open. */
export async function copyMyCode(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy my code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}
export async function invite(page: Page): Promise<string> {
  await page.locator('.new-conversation').click();
  await page.locator('#show-create-account').click();
  await expect(page.locator('#local-passphrase')).toHaveCount(0);
  const linkCreated = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  expect((await linkCreated).status()).toBe(200);
  const input = page.getByRole('textbox', { name: 'Private invitation' });
  await expect(input).toHaveValue(/#(?:invite|modern)=/, { timeout: 30_000 });
  const link = await input.inputValue();
  await page.getByRole('button', { name: 'Continue to your chats', exact: true }).click();
  return link;
}


export async function connectedPair(browser: import('@playwright/test').Browser, diagnostics = false) {
  const a = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const b = await browser.newContext({ permissions: ['microphone', 'camera'] });
  if (diagnostics) {
    await a.addInitScript(() => { (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
    await b.addInitScript(() => { (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  }
  const alice = await a.newPage(); const bob = await b.newPage();
  await create(alice, 'Alice'); await create(bob, 'Bob');
  const link = await invite(alice);
  await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(link); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30000 });
  await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  for (const page of [alice, bob]) {
    await security(page); await page.getByRole('button', { name: 'No', exact: true }).click(); await page.getByRole('button', { name: 'No, we’ll call', exact: true }).click(); await page.getByRole('button', { name: 'They match', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  }
  return { a, b, alice, bob };
}

/** A connected pair where nobody has checked anybody yet (M1c). */
export async function uncheckedPair(browser: import('@playwright/test').Browser, names: [string, string] = ['Alice', 'Bob']) {
  const a = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const b = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const alice = await a.newPage(); const bob = await b.newPage();
  await create(alice, names[0]); await create(bob, names[1]);
  const link = await invite(alice);
  await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(link); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText(names[1], { timeout: 30000 });
  await expect(bob.locator('.chat-header')).toContainText(names[0], { timeout: 30000 });
  return { a, b, alice, bob };
}

/** Remote check: not Android, apart, numbers match. "They match" records the check. */
export async function checkByNumbers(page: Page) {
  await security(page);
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  await page.getByRole('button', { name: 'They match', exact: true }).click();
  await expect(page.locator('.verification-summary')).toContainText('Checked on this device');
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
}

/** Part A2 bug 1: a sent file's composer row clears once the file is in the chat. */
export async function expectFileSent(page: Page, timeout = 60_000) {
  await expect(page.locator('.file-transfer-card')).toHaveCount(0, { timeout });
  await expect(page.locator('.message.sent.message--file').last()).toBeVisible();
}
