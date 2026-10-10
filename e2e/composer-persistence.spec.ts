import { test, expect, type Page } from '@playwright/test';
import { create, invite } from './usabilityHelpers';

const verify = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await page.getByRole('button', { name: 'Codes match', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

const composerState = (page: Page) => page.evaluate(() => {
  const footer = document.querySelector<HTMLElement>('.chat-footer');
  const container = document.querySelector<HTMLElement>('#chat-container');
  const input = document.querySelector<HTMLElement>('#msg-input');
  const rect = (element: HTMLElement | null) => {
    if (!element) return null;
    const { x, y, width, height, top, bottom } = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x, y, width, height, top, bottom, display: style.display, visibility: style.visibility, opacity: style.opacity };
  };
  return {
    footerConnected: Boolean(footer?.isConnected), inputConnected: Boolean(input?.isConnected),
    footer: rect(footer), input: rect(input), container: rect(container),
    viewport: { width: innerWidth, height: innerHeight },
    emptyPage: Boolean(document.querySelector('.chat-empty-page')),
    activeRoomSelected: Boolean(document.querySelector('.conversation-row.active')),
  };
});

const openContact = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: name });
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(page.locator('.chat-header')).toContainText(name, { timeout: 30_000 });
};

test('keeps the composer mounted and usable through history, room switches, restore, and calls', async ({ browser }) => {
  test.setTimeout(240_000);
  const contexts = [
    await browser.newContext({ permissions: ['microphone', 'camera'] }),
    await browser.newContext({ permissions: ['microphone', 'camera'] }),
    await browser.newContext({ permissions: ['microphone', 'camera'] }),
  ];
  const [alice, bob, carol] = await Promise.all(contexts.map((context) => context.newPage()));

  await create(alice, 'Composer Alice');
  await create(bob, 'Composer Bob');
  const abInvite = await invite(alice);
  await bob.locator('.new-conversation').click();
  await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(abInvite);
  await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Composer Bob', { timeout: 30_000 });
  await expect(bob.locator('.chat-header')).toContainText('Composer Alice', { timeout: 30_000 });
  await verify(alice);
  await verify(bob);

  const acInvite = await invite(alice);
  await create(carol, 'Composer Carol');
  await carol.locator('.new-conversation').click();
  await carol.getByRole('button', { name: 'I have an invitation' }).click();
  await carol.locator('#channel-hash').fill(acInvite);
  await carol.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Composer Carol', { timeout: 30_000 });
  await expect(carol.locator('.chat-header')).toContainText('Composer Alice', { timeout: 30_000 });
  await verify(alice);
  await verify(carol);

  await alice.evaluate(() => {
    const target = globalThis as typeof globalThis & { __composerUnmounts?: string[] };
    target.__composerUnmounts = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.removedNodes)) {
          if (node instanceof Element && (node.matches('.chat-footer') || node.querySelector('.chat-footer'))) {
            target.__composerUnmounts?.push(node.matches('.chat-container') ? 'chat-container-removed' : 'composer-parent-removed');
          }
        }
      }
    });
    observer.observe(document.querySelector('#root') ?? document.body, { childList: true, subtree: true });
  });
  await openContact(alice, 'Composer Bob');
  const initial = await composerState(alice);
  expect(initial.footerConnected).toBe(true);
  expect(initial.inputConnected).toBe(true);
  expect(await alice.evaluate(() => (globalThis as typeof globalThis & { __composerUnmounts?: string[] }).__composerUnmounts ?? [])).toEqual([]);
  console.log('COMPOSER_SNAPSHOT_INITIAL', JSON.stringify(initial));

  for (let index = 0; index < 30; index += 1) {
    await bob.getByRole('textbox', { name: 'Write a message', exact: true }).fill(`history item ${index}`);
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  await expect(alice.locator('#messages-area .message')).toHaveCount(30, { timeout: 30_000 });
  await expect(alice.locator('.chat-footer')).toBeVisible();
  const hydrated = await composerState(alice);
  expect(hydrated.footerConnected).toBe(true);
  expect(hydrated.footer!.bottom).toBeLessThanOrEqual(hydrated.viewport.height + 1);
  expect(await alice.locator('#messages-area').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  console.log('COMPOSER_SNAPSHOT_HYDRATED', JSON.stringify(hydrated));

  for (let index = 0; index < 10; index += 1) {
    await openContact(alice, 'Composer Carol');
    await expect(alice.locator('.chat-footer')).toBeVisible();
    await openContact(alice, 'Composer Bob');
    await expect(alice.locator('.chat-footer')).toBeVisible();
  }
  const switched = await composerState(alice);
  console.log('COMPOSER_SNAPSHOT_SWITCHED', JSON.stringify(switched));
  await expect(alice.getByRole('textbox', { name: 'Write a message', exact: true })).toBeVisible();
  expect(await alice.evaluate(() => (globalThis as typeof globalThis & { __composerUnmounts?: string[] }).__composerUnmounts ?? [])).toEqual([]);

  await alice.reload();
  await expect(alice.getByRole('button', { name: 'Unlock this device', exact: true })).toBeVisible({ timeout: 30_000 });
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(alice.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('.chat-footer')).toBeVisible();
  const restored = await composerState(alice);
  expect(restored.footerConnected).toBe(true);
  console.log('COMPOSER_SNAPSHOT_RESTORED', JSON.stringify(restored));

  const restoredHeader = await alice.locator('.chat-header').innerText();
  const receiver = restoredHeader.includes('Composer Carol') ? carol : bob;
  const receiverName = receiver === carol ? 'Composer Carol' : 'Composer Bob';
  for (const mode of ['audio', 'video'] as const) {
    await alice.getByRole('button', { name: 'Calls', exact: true }).click();
    await alice.getByRole('button', { name: mode === 'audio' ? 'Start audio call' : 'Start video call', exact: true }).click();
    await receiver.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 20_000 });
    await receiver.getByRole('button', { name: 'End call', exact: true }).click();
    await expect(alice.locator('.call-info')).not.toBeVisible();
    await expect(receiver.locator('.call-info')).not.toBeVisible();
    await alice.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(alice.locator('.chat-footer')).toBeVisible();
  }
  console.log('COMPOSER_AFTER_AUDIO_VIDEO_CALLS', receiverName, JSON.stringify(await composerState(alice)));

  for (const [width, height] of [[1280, 800], [900, 650], [390, 720], [1280, 560]] as const) {
    await alice.setViewportSize({ width, height });
    await expect(alice.getByRole('textbox', { name: 'Write a message', exact: true })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Attach a photo or file, up to 8 MiB', exact: true })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Attach a photo or file, up to 8 MiB', exact: true })).toBeEnabled();
    const messageInput = alice.getByRole('textbox', { name: 'Write a message', exact: true });
    await messageInput.fill('composer control check');
    await expect(alice.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await messageInput.fill('');
    const state = await composerState(alice);
    console.log(`COMPOSER_VIEWPORT_${width}x${height}`, JSON.stringify(state));
  }


  await Promise.all(contexts.map((context) => context.close()));
});
