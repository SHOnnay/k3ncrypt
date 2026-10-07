import { test, expect, type Page } from '@playwright/test';
import { connectedPair, create } from './usabilityHelpers';

const screenshotWidths = [1440, 1024, 768, 390, 320];
const auditWidths = [1440, 1280, 1024, 768, 480, 390, 360, 320];

async function checkViewport(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
  await page.waitForTimeout(80);
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll<HTMLElement>('.conversation-workspace, #chat-container, .chat-empty-page, .workspace-page, .settings-panel, .settings-panel__body, .overlay, .overlay-content, .call-info, .call-video-stage, .chat-footer')]
      .filter(element => getComputedStyle(element).display !== 'none')
      .map(element => ({ name: element.className || element.id, width: element.clientWidth, scrollWidth: element.scrollWidth }))
      .filter(element => element.scrollWidth > element.width + 1),
    offscreenButtons: [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => getComputedStyle(button).display !== 'none' && button.getClientRects().length)
      .map(button => ({ name: button.getAttribute('aria-label') || button.textContent?.trim(), rect: button.getBoundingClientRect().toJSON() }))
      .filter(button => button.rect.left < -1 || button.rect.right > window.innerWidth + 1),
  }));
  expect(result.document, `document overflows at ${width}`).toBeLessThanOrEqual(width);
  expect(result.overflow, `horizontal container overflow at ${width}`).toEqual([]);
  expect(result.offscreenButtons, `button clipped at ${width}`).toEqual([]);
}

test('responsive layouts fit audited widths and capture representative screens', async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  const screenshots = testInfo.outputPath('responsive-review');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(screenshots, { recursive: true });
  const capture = async (page: Page, label: string) => {
    for (const width of screenshotWidths) {
      await checkViewport(page, width);
      await page.screenshot({ path: `${screenshots}/${label}-${width}.png` });
    }
  };

  // Empty Chats and invitation screens from a dedicated account.
  const emptyContext = await browser.newContext();
  const empty = await emptyContext.newPage();
  await empty.goto('/');
  await expect(empty.locator('#show-create-account')).toBeVisible();
  await capture(empty, 'account-setup');
  await create(empty, 'Responsive');
  await expect(empty.locator('.chat-empty-page')).toBeVisible();
  await capture(empty, 'empty-chats');
  await empty.setViewportSize({ width: 1280, height: 800 });
  await empty.locator('.new-conversation').click();
  await empty.locator('#show-create-account').click();
  await expect(empty.getByRole('button', { name: 'Create invitation', exact: true })).toBeVisible();
  await empty.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(empty.getByRole('textbox', { name: 'Private invitation' })).toBeVisible();
  await capture(empty, 'invitation');
  await emptyContext.close();

  const { a, b, alice, bob } = await connectedPair(browser);
  await capture(alice, 'active-chat');
  await alice.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await capture(alice, 'settings');
  await alice.getByRole('button', { name: 'Security' }).click();
  await capture(alice, 'verification');
  await alice.getByRole('button', { name: 'Show my QR', exact: true }).click();
  await capture(alice, 'verification-qr');
  await alice.getByRole('button', { name: 'Close settings' }).click();
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await capture(alice, 'calls');

  // Exercise the remaining audited sizes on the app shells that carry the most controls.
  for (const width of auditWidths) {
    await checkViewport(alice, width);
    await alice.getByRole('button', { name: 'Chats', exact: true }).click();
    await checkViewport(alice, width);
    await alice.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await checkViewport(alice, width);
    await alice.getByRole('button', { name: 'Close settings' }).click();
    if (width <= 480) {
      await expect(alice.locator('.chat-footer textarea, .chat-footer input[type="text"]')).toBeVisible();
      await expect(alice.locator('.header-actions button')).toHaveCount(await alice.locator('.header-actions button:visible').count());
    }
  }
  await expect(alice.locator('.chat-footer')).toBeVisible();
  await a.close(); await b.close();
});
