import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { create, invite } from './usabilityHelpers';

const passphrase = 'alpha-family-existing-account-2026';
const select = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator('.chat-header')).toContainText(name);
};
const verify = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security Your identity and contact verification', exact: true }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

test('both participants restore exactly one completed call from encrypted history after browser processes restart', async ({ baseURL }) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp('/private/tmp/k3ncrypt-call-history-');
  const contexts = new Set<BrowserContext>();
  const close = async (context: BrowserContext) => {
    // A normal exit runs the application's existing pagehide/beforeunload
    // lease release. Context.close alone emulates an abrupt browser kill.
    for (const page of context.pages()) await page.close({ runBeforeUnload: true });
    await context.close(); contexts.delete(context);
  };
  const launch = async (name: string) => {
    const context = await chromium.launchPersistentContext(`${directory}/${name}`, {
      baseURL, headless: true, permissions: ['microphone', 'camera'],
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    contexts.add(context);
    return context;
  };
  const unlock = async (context: BrowserContext, name: string) => {
    const page = context.pages()[0];
    await page.goto('/');
    await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await page.locator('input[type=password]').fill(passphrase);
    await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await select(page, name);
    return page;
  };
  try {
    const a = await launch('alice'), b = await launch('bob');
    const alice = a.pages()[0], bob = b.pages()[0];
    await create(alice, 'Alice'); await create(bob, 'Bob');
    const invitation = await invite(alice);
    await bob.locator('.new-conversation').click();
    await bob.getByRole('button', { name: 'I have an invitation' }).click();
    await bob.locator('#channel-hash').fill(invitation);
    await bob.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
    await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    await verify(alice); await verify(bob);
    await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
    await bob.getByRole('button', { name: 'Accept call', exact: true }).click();
    for (const page of [alice, bob]) await expect(page.locator('#call-status')).toHaveText('Connected', { timeout: 20_000 });
    await bob.getByRole('button', { name: 'End call', exact: true }).click();
    for (const page of [alice, bob]) {
      await expect(page.locator('.call-info')).not.toBeVisible();
      await expect(page.getByLabel('Local call history')).toHaveCount(1);
      await expect(page.getByLabel('Local call history')).toContainText('Voice call');
    }
    // The panel update must preserve real preferences across process restart.
    for (const page of [alice, bob]) {
      await page.getByRole('button', { name: 'Open settings' }).click();
      await page.getByRole('button', { name: /^Privacy / }).click();
      await page.getByRole('checkbox', { name: /^Blur sensitive content/ }).check();
      await page.getByRole('button', { name: 'Close settings' }).click();
    }
    // Closing persistent contexts terminates their Chromium processes. Reopen
    // the same disposable profiles, without copying plaintext storage state.
    await close(a); await close(b);
    const restartedAlice = await unlock(await launch('alice'), 'Bob');
    const restartedBob = await unlock(await launch('bob'), 'Alice');
    for (const page of [restartedAlice, restartedBob]) {
      await expect(page.getByLabel('Local call history')).toHaveCount(1);
      await expect(page.getByLabel('Local call history')).toContainText('Voice call');
      await page.getByRole('button', { name: 'Open settings' }).click();
      await page.getByRole('button', { name: /^Security / }).click();
      await expect(page.locator('.verification-summary')).toContainText('Verified');
      await page.getByRole('button', { name: 'Back to settings' }).click();
      await page.getByRole('button', { name: /^Privacy / }).click();
      await expect(page.getByRole('checkbox', { name: /^Blur sensitive content/ })).toBeChecked();
      await page.getByRole('button', { name: 'Close settings' }).click();

    }
  } finally {
    try { await Promise.all([...contexts].map(close)); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});
