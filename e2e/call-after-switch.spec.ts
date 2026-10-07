import { test, expect, type Page } from '@playwright/test';
import { connectedPair, create, invite } from './usabilityHelpers';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

const verify = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

const openContact = async (page: Page, name: string) => {
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
  });
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await row.click();
  await expect.poll(() => page.locator('html').getAttribute('data-k3ncrypt-conversation-open'), { timeout: 30000 }).toMatch(/^(connected|same-room)$/);
  await expect(row).toHaveClass(/active/);
  try { await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30000 }); }
  catch (error) {
    const active = await page.locator('.conversation-row.active').innerText().catch(() => 'none');
    const failure = await page.locator('.app-error').innerText().catch(() => 'none');
    const header = await page.locator('.chat-header').innerText().catch(() => 'none');
    console.log('SWITCH_SAFE_STATE', `target=${name};active=${active};failure=${failure};header=${header}`);
    throw error;
  }
};

const startAndDecline = async (caller: Page, receiver: Page) => {
  await caller.getByRole('button', { name: 'Calls', exact: true }).click();
  const start = caller.getByRole('button', { name: 'Start audio call', exact: true });
  await expect(start).toBeEnabled(); await start.click();
  await receiver.getByRole('button', { name: 'Decline call', exact: true }).click({ timeout: 20000 });
  await expect(caller.locator('.call-info')).not.toBeVisible();
  await expect(receiver.locator('.call-info')).not.toBeVisible();
};

const enableSafeCallDiagnostics = async (page: Page, output: string[]) => {
  page.on('console', message => {
    const match = message.text().match(/^k3ncrypt-call-(?:failure|transport|negotiation):[a-z-]+$|^k3ncrypt-call-start-failed:[a-z-]+:[a-z-]+$/);
    if (match) output.push(match[0]);
  });
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    const category = path.includes('/device-trust/proof') ? 'device-proof' : path.includes('/prekeys') ? 'prekey' : path.includes('/chat-link/') ? 'room-control' : 'other-api';
    console.log('CALL_SAFE_HTTP', `${response.request().method()}:${category}:${response.status()}:retry=${response.headers()['retry-after'] ?? 'none'}`);
  });
};

test('audio call support follows the selected contact and decline permits a call to the next contact', async ({ browser }) => {
  test.setTimeout(240000);
  const { a, b, alice, bob } = await connectedPair(browser);
  const c = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const cara = await c.newPage(); await create(cara, 'Cara');
  const invitation = await invite(alice);
  await cara.locator('.new-conversation').click(); await cara.getByRole('button', { name: 'I have an invitation' }).click();
  await cara.locator('#channel-hash').fill(invitation); await cara.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Cara', { timeout: 30000 });
  await expect(cara.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
  await verify(alice); await verify(cara);
  await openContact(alice, 'Bob');
  await bob.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Alice');
  await bob.getByRole('button', { name: 'Send message', exact: true }).click();
  await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Bob');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  await openContact(alice, 'Cara');
  await cara.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Alice');
  await cara.getByRole('button', { name: 'Send message', exact: true }).click();
  await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('hello Cara');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  const callDiagnostics: string[] = [];
  await enableSafeCallDiagnostics(alice, callDiagnostics);
  await enableSafeCallDiagnostics(bob, callDiagnostics);
  await enableSafeCallDiagnostics(cara, callDiagnostics);
  await openContact(alice, 'Bob');
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  await expect(bob.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
  await expect(alice.locator('.call-contact-name')).toHaveText('Bob');
  await expect(alice.locator('#call-status')).toHaveText('Connected');
  await bob.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(alice.locator('.call-info')).not.toBeVisible();
  await expect(bob.locator('.call-info')).not.toBeVisible();
  await openContact(alice, 'Cara');
  await startAndDecline(alice, cara);
  const observed = async (receiver: Page) => {
    try { await startAndDecline(alice, receiver); }
    catch (error) { console.log('SAFE_CALL_DIAGNOSTICS', callDiagnostics.sort().join(',')); throw error; }
  };
  await openContact(alice, 'Bob'); await observed(bob);
  await openContact(alice, 'Cara'); await observed(cara);
  await openContact(alice, 'Bob'); await observed(bob);
  await a.close(); await b.close(); await c.close();
});
