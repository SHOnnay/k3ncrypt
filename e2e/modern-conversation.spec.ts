import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const PASSPHRASE = 'paper-ink-private-room-2026';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_CLIENT_PORT ?? '43102'}`;

const captureOutbound = (page: Page, bodies: string[]) => {
  page.on('request', (request) => { if (request.method() !== 'GET') bodies.push(request.postData() ?? ''); });
  page.on('websocket', (socket) => { socket.on('framesent', (frame) => bodies.push(String(frame.payload))); });
};

async function open(browser: Browser, link = BASE_URL): Promise<{ context: BrowserContext; page: Page; outbound: string[] }> {
  const context = await browser.newContext();
  await context.addInitScript(() => { (window as Window & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  const page = await context.newPage();
  const outbound: string[] = [];
  captureOutbound(page, outbound);
  page.on('response', (response) => { if (!response.ok()) console.log(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto(link);
  await expect(page.locator('#show-join-hash')).toBeVisible();
  return { context, page, outbound };
}

async function resume(context: BrowserContext, link: string, outbound: string[] = []): Promise<Page> {
  const page = await context.newPage();
  captureOutbound(page, outbound);
  await page.goto(link);
  const unlockButton = page.getByRole('button', { name: 'Unlock this device' });
  const invitationButton = page.getByRole('button', { name: 'I have an invitation' });
  await expect(unlockButton.or(invitationButton)).toBeVisible();
  if (await unlockButton.isVisible()) {
    await page.getByRole('button', { name: 'Unlock this device' }).click();
    await page.locator('input[type="password"]').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock account' }).click();
  } else {
    await page.getByRole('button', { name: 'I have an invitation' }).click();
    await expect(page.locator('#channel-hash')).toHaveValue(/modern=/);
    await page.locator('input[type="password"]').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.locator('#chat-container')).toBeVisible();
  return page;
}

test('modern private contact works after offline recipient and both browser restarts', async ({ browser }) => {
  test.setTimeout(120_000);
  const bob = await open(browser);
  await bob.page.getByRole('button', { name: 'Create your private account' }).click();
  await bob.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Bob');
  await bob.page.locator('#local-passphrase').fill(PASSPHRASE);
  await bob.page.locator('#local-passphrase-confirm').fill(PASSPHRASE);
  const creation = bob.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await bob.page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await creation).status()).toBe(200);
  const invitation = bob.page.getByRole('textbox', { name: 'Private invitation' });
  await expect(invitation).toHaveValue(/#modern=[^&]+&control=[^&]+&address=/);
  const link = await invitation.inputValue();
  await bob.page.getByRole('button', { name: 'Continue to your chats' }).click();
  await bob.page.close({ runBeforeUnload: true });

  const alice = await open(browser, link);
  await alice.page.getByRole('button', { name: 'I have an invitation' }).click();
  await expect(alice.page.locator('#channel-hash')).toHaveValue(/modern=/);
  await alice.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice');
  await alice.page.getByLabel('Choose a passphrase', { exact: true }).fill(PASSPHRASE);
  await alice.page.getByLabel('Confirm your passphrase', { exact: true }).fill(PASSPHRASE);
  await alice.page.getByRole('button', { name: 'Continue' }).click();
  await expect(alice.page.locator('#chat-container')).toBeVisible();
  await expect(alice.page.locator('.chat-header')).toContainText(/Contact · [A-F0-9]{4}/);
  await alice.page.locator('#msg-input').fill('hello while you were away');
  await alice.page.locator('#send-btn').click();

  const bobReturned = await resume(bob.context, link, bob.outbound);
  await expect(bobReturned.locator('#messages-area')).toContainText('hello while you were away', { timeout: 20_000 });
  await bobReturned.getByRole('button', { name: 'Open settings' }).click();
  await bobReturned.getByRole('button', { name: 'Security' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Make sure you are really talking to Alice.');
  await expect(bobReturned.locator('.verification-view')).toContainText('Unverified');
  const bobFingerprint = await bobReturned.locator('.verification-code').first().textContent();
  await alice.page.getByRole('button', { name: 'Open settings' }).click();
  await alice.page.getByRole('button', { name: 'Security' }).click();
  await expect(alice.page.locator('.verification-code').last()).toHaveText(bobFingerprint ?? '');
  await alice.page.getByRole('button', { name: 'Close settings' }).click();
  const markVerified = bobReturned.getByRole('button', { name: 'Mark as verified' });
  await expect(markVerified).toBeDisabled();
  await bobReturned.getByRole('button', { name: 'They don\'t match' }).click();
  await expect(markVerified).toBeDisabled();
  await bobReturned.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await bobReturned.getByRole('button', { name: 'Codes match' }).click();
  await expect(markVerified).toBeEnabled();
  await bobReturned.getByRole('button', { name: 'Mark as verified' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Verified');
  await bobReturned.getByRole('button', { name: 'Back to settings' }).click();
  await bobReturned.getByRole('button', { name: 'Security' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Verified');
  await bobReturned.getByRole('button', { name: 'Close settings' }).click();
  await bobReturned.locator('#msg-input').fill('I am here now');
  await bobReturned.locator('#send-btn').click();
  await expect(alice.page.locator('#messages-area')).toContainText('I am here now');

  await bobReturned.close({ runBeforeUnload: true });
  await alice.page.close({ runBeforeUnload: true });
  const bobAgain = await resume(bob.context, link);
  const aliceAgain = await resume(alice.context, link);
  await bobAgain.getByRole('button', { name: 'Open settings' }).click();
  await bobAgain.getByRole('button', { name: 'Security' }).click();
  await expect(bobAgain.locator('.verification-view')).toContainText('Verified');
  await expect(bobAgain.locator('.verification-code').first()).toHaveText(bobFingerprint ?? '');
  await bobAgain.getByRole('button', { name: 'Close settings' }).click();
  await aliceAgain.locator('#msg-input').fill('after restart');
  await aliceAgain.locator('#send-btn').click();
  await expect(bobAgain.locator('#messages-area')).toContainText('after restart');
  await bobAgain.locator('#msg-input').fill('still private');
  await bobAgain.locator('#send-btn').click();
  await expect(aliceAgain.locator('#messages-area')).toContainText('still private');
  for (const text of ['hello while you were away', 'I am here now']) {
    expect(alice.outbound.join('\n')).not.toContain(text);
    expect(bob.outbound.join('\n')).not.toContain(text);
  }
  for (const page of [aliceAgain, bobAgain]) {
    const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(browserStorage).not.toContain('hello while you were away');
    expect(browserStorage).not.toContain(PASSPHRASE);
  }
  await bob.context.close();
  await alice.context.close();
});
