import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { checkByNumbers, uncheckedPair } from '../e2e/usabilityHelpers';

// M3j: the PRODUCTION build under the PRODUCTION headers, in a real browser. Any CSP
// violation during account setup, check, message, file and call fails the test.
const watch = async (context: BrowserContext, violations: string[]) => {
  await context.addInitScript(() => {
    const store = ((globalThis as unknown as { __csp: string[] }).__csp = []);
    document.addEventListener('securitypolicyviolation', (event) => store.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  context.on('console', (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text().slice(0, 200)); });
};
const collected = (page: Page) => page.evaluate(() => (globalThis as unknown as { __csp?: string[] }).__csp ?? []);

test('production build runs the main flows with zero CSP violations and full headers', async ({ browser }) => {
  const violations: string[] = [];
  const probe = await browser.newContext();
  const response = await (await probe.newPage()).goto('/');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['x-frame-options']).toBe('DENY');
  await probe.close();

  const realNew = browser.newContext.bind(browser);
  (browser as unknown as { newContext: typeof browser.newContext }).newContext = async (options) => { const context = await realNew({ ...options, ignoreHTTPSErrors: true }); await watch(context, violations); return context; };
  const { a, b, alice, bob } = await uncheckedPair(browser);
  await checkByNumbers(alice); await checkByNumbers(bob);
  await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('CSP stage message');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(bob.locator('.message-text').filter({ hasText: 'CSP stage message' })).toBeVisible({ timeout: 30_000 });
  await alice.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64') });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 60_000 });
  await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
  await expect(bob.getByRole('link', { name: 'Save photo.png', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(bob.getByAltText('Downloaded photo')).toBeVisible();
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  const fromPages = [...await collected(alice), ...await collected(bob)];
  expect([...violations, ...fromPages]).toEqual([]);
  // Control: the detector must see a real violation (an external image is outside img-src).
  await alice.evaluate(() => { const image = document.createElement('img'); image.src = 'https://example.invalid/tracker.png'; document.body.append(image); });
  await expect.poll(async () => (await collected(alice)).some((entry) => entry.startsWith('img-src'))).toBe(true);
  await a.close(); await b.close();
});
