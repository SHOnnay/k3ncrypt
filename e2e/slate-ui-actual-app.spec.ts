import { test, expect } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

test('authenticated Slate Trust app navigation, themes, messages, and narrow composer remain usable', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    const thirdPartyFontRequests = await alice.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /fonts\.(googleapis|gstatic)\.com/i.test(url)));
    expect(thirdPartyFontRequests).toEqual([]);
    await alice.evaluate(async () => {
      await Promise.all([document.fonts.load('500 16px Inter'), document.fonts.load('600 20px Fraunces')]);
    });
    expect(await alice.evaluate(() => document.fonts.check('500 16px Inter'))).toBe(true);
    expect(await alice.evaluate(() => document.fonts.check('600 20px Fraunces'))).toBe(true);

    await alice.locator('#msg-input').fill('Slate UI real-account smoke message');
    await alice.locator('#send-btn').click();
    await expect(bob.locator('#messages-area')).toContainText('Slate UI real-account smoke message', { timeout: 20_000 });
    await bob.locator('#msg-input').fill('Slate UI received-message contrast check');
    await bob.locator('#send-btn').click();
    await expect(alice.locator('#messages-area')).toContainText('Slate UI received-message contrast check', { timeout: 20_000 });
    await alice.screenshot({ path: testInfo.outputPath('authenticated-chat-light-desktop.png'), fullPage: false });

    await alice.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(alice.locator('.workspace-page h1')).toHaveText('Contacts');
    await expect(alice.locator('.workspace-contact').filter({ hasText: 'Bob' })).toBeVisible();
    await alice.locator('.workspace-contact').filter({ hasText: 'Bob' }).click();
    await expect(alice.locator('.chat-header')).toContainText('Bob');

    await alice.getByRole('button', { name: 'Calls', exact: true }).click();
    await expect(alice.locator('.workspace-page h1')).toHaveText('Calls');
    await expect(alice.getByRole('button', { name: 'Start audio call', exact: true })).toBeEnabled();
    await expect(alice.getByRole('button', { name: 'Start video call', exact: true })).toBeEnabled();
    await alice.getByRole('button', { name: 'Chats', exact: true }).click();
    await alice.locator('.conversation-row').filter({ hasText: 'Bob' }).click();

    await alice.getByRole('button', { name: 'Open settings' }).click();
    await alice.getByRole('button', { name: /^Appearance/ }).click();
    await alice.getByRole('radio', { name: /Slate Dusk/ }).click();
    await expect(alice.locator('html')).toHaveAttribute('data-theme', 'slate');
    await alice.waitForTimeout(300);
    await alice.screenshot({ path: testInfo.outputPath('authenticated-slate-dark.png'), fullPage: false });
    await alice.getByRole('button', { name: 'Back to settings' }).click();
    await alice.getByRole('button', { name: /^Security/ }).click();
    await expect(alice.locator('.verification-view')).toContainText('Verified');
    await alice.getByRole('button', { name: 'Back to settings' }).click();
    await alice.getByRole('button', { name: /^Appearance/ }).click();
    await alice.getByRole('radio', { name: /Paper & Ink/ }).click();
    await expect(alice.locator('html')).toHaveAttribute('data-theme', 'paper');
    const lightMutedContrast = await alice.evaluate(() => {
      const luminance = (value: string) => {
        const channels = value.match(/[\da-f]{2}/gi)?.map(channel => parseInt(channel, 16) / 255) ?? [];
        const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return linear.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      };
      const style = getComputedStyle(document.documentElement);
      const foreground = style.getPropertyValue('--muted').trim();
      return ['--canvas', '--canvas-soft', '--surface', '--surface-raised', '--surface-muted', '--surface-tint', '--brand-soft', '--message-sent', '--success-soft', '--danger-soft', '--warn-soft']
        .map(token => {
          const background = style.getPropertyValue(token).trim();
          const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
          return (lighter + 0.05) / (darker + 0.05);
        });
    });
    expect(Math.min(...lightMutedContrast)).toBeGreaterThanOrEqual(4.5);
    const receivedMetadata = alice.locator('.message.received .message-meta').first();
    await expect(receivedMetadata).toBeVisible();
    const receivedMetadataContrast = await receivedMetadata.evaluate(element => {
      const luminance = (value: string) => {
        const channels = value.match(/[\da-f]{2}/gi)?.map(channel => parseInt(channel, 16) / 255) ?? [];
        const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return linear.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      };
      const rgb = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      const toHex = (channels: number[]) => `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
      const foreground = toHex(rgb(getComputedStyle(element).color));
      const background = toHex(rgb(getComputedStyle(element.parentElement!).backgroundColor));
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return { opacity: getComputedStyle(element).opacity, ratio: (lighter + 0.05) / (darker + 0.05) };
    });
    expect(receivedMetadataContrast.opacity).toBe('1');
    expect(receivedMetadataContrast.ratio).toBeGreaterThanOrEqual(4.5);
    await alice.waitForTimeout(300);
    await alice.screenshot({ path: testInfo.outputPath('authenticated-slate-light.png'), fullPage: false });
    await alice.keyboard.press('Tab');
    expect(await alice.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await alice.getByRole('button', { name: 'Close settings' }).click();
    await alice.screenshot({ path: testInfo.outputPath('authenticated-chat-light-desktop.png'), fullPage: false });
    await alice.getByRole('button', { name: 'Open settings' }).click();
    await alice.getByRole('button', { name: /^Appearance/ }).click();
    await alice.getByRole('radio', { name: /Slate Dusk/ }).click();
    await expect(alice.locator('html')).toHaveAttribute('data-theme', 'slate');
    await alice.waitForTimeout(300);
    await alice.getByRole('button', { name: 'Close settings' }).click();
    await alice.screenshot({ path: testInfo.outputPath('authenticated-chat-dark-desktop.png'), fullPage: false });

    for (const width of [320, 360, 393]) {
      await alice.setViewportSize({ width, height: 780 });
      const layout = await alice.evaluate(() => {
        const composer = document.querySelector<HTMLElement>('.chat-footer');
        const input = document.querySelector<HTMLElement>('#msg-input');
        const rect = composer?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          composerRight: rect?.right ?? Infinity,
          composerBottom: rect?.bottom ?? Infinity,
          inputVisible: Boolean(input && rect && input.getBoundingClientRect().height > 0),
        };
      });
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.composerRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.composerBottom).toBeLessThanOrEqual(780 + 1);
      expect(layout.inputVisible).toBe(true);
      if (width === 320) await alice.screenshot({ path: testInfo.outputPath('authenticated-slate-mobile-320.png'), fullPage: false });
    }

    await alice.reload();
    await expect(alice.getByRole('button', { name: 'Unlock this device', exact: true })).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});
