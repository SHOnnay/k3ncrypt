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
  await page.goto(link);
  await expect(page.locator('#show-join-hash')).toBeVisible();
  return { context, page, outbound };
}

async function resume(context: BrowserContext, link: string, outbound: string[] = []): Promise<Page> {
  const page = await context.newPage();
  captureOutbound(page, outbound);
  await page.goto(link);
  await page.click('#show-join-hash');
  await expect(page.locator('#channel-hash')).toHaveValue(/modern=/);
  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.locator('#chat-container')).toBeVisible();
  return page;
}

const cryptoSnapshot = (page: Page) => page.evaluate(() => (window as Window & { __k3ncryptGetCryptoSnapshot?: () => Promise<unknown> }).__k3ncryptGetCryptoSnapshot?.());

test('modern private contact works after offline recipient and both browser restarts', async ({ browser }) => {
  test.setTimeout(120_000);
  const bob = await open(browser);
  await bob.page.getByRole('button', { name: /Create a private contact/ }).click();
  await bob.page.locator('input[type="password"]').fill(PASSPHRASE);
  const creation = bob.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await bob.page.getByRole('button', { name: 'Create private contact' }).click();
  expect((await creation).status()).toBe(200);
  const invitation = bob.page.getByRole('textbox', { name: 'Modern invitation' });
  await expect(invitation).toHaveValue(/#modern=[^&]+&control=[^&]+&address=/);
  const link = await invitation.inputValue();
  await bob.page.getByRole('button', { name: 'Continue to conversation' }).click();
  const beforeShutdown = await cryptoSnapshot(bob.page);
  await bob.page.close({ runBeforeUnload: true });

  const alice = await open(browser, link);
  await alice.page.click('#show-join-hash');
  await expect(alice.page.locator('#channel-hash')).toHaveValue(/modern=/);
  await alice.page.locator('input[type="password"]').fill(PASSPHRASE);
  await alice.page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(alice.page.locator('#chat-container')).toBeVisible();
  const senderSnapshot = await cryptoSnapshot(alice.page);
  await expect(alice.page.locator('.chat-header')).toContainText('Modern private');
  await alice.page.locator('#msg-input').fill('hello while you were away');
  await alice.page.locator('#send-btn').click();

  const bobReturned = await resume(bob.context, link, bob.outbound);
  const afterRestore = await cryptoSnapshot(bobReturned);
  expect(beforeShutdown).toEqual(expect.objectContaining({ identityFingerprint: expect.any(String), oneTimeKeyIds: expect.any(Array) }));
  expect(senderSnapshot).toEqual(expect.objectContaining({ selectedRecipientKeyId: expect.any(String) }));
  expect(afterRestore).toEqual(expect.objectContaining({ identityFingerprint: expect.any(String), oneTimeKeyIds: expect.any(Array), lastInboundEnvelope: expect.objectContaining({ protocolVersion: 1, messageType: 0 }), runtimeStage: 'returned' }));
  await expect(bobReturned.locator('#messages-area')).toContainText('hello while you were away', { timeout: 20_000 });
  await bobReturned.getByRole('button', { name: 'Open settings' }).click();
  await bobReturned.getByRole('button', { name: /Identity/ }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Unverified');
  const bobFingerprint = await bobReturned.locator('.verification-code').first().textContent();
  await alice.page.getByRole('button', { name: 'Open settings' }).click();
  await alice.page.getByRole('button', { name: /Identity/ }).click();
  await expect(alice.page.locator('.verification-code').last()).toHaveText(bobFingerprint ?? '');
  await alice.page.getByRole('button', { name: 'Close settings' }).click();
  await bobReturned.getByRole('checkbox', { name: /compared the fingerprints/ }).check();
  await bobReturned.getByRole('button', { name: 'Mark as verified' }).click();
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
  await bobAgain.getByRole('button', { name: /Identity/ }).click();
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
