import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { connectedPair } from './usabilityHelpers';

// UX Part B (opt-in: UX_DIRECTIONS=true). Screenshots of four screens in each proposed visual direction.
// The directions are stylesheets over the existing tokens (docs/ux/part-b/*.css); product code is unchanged.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const dir = process.env.DIRECTIONS_DIR ?? 'test-results/ux-directions';
const directions = [
  ['current', undefined], ['a-quiet-paper', 'a'], ['b-soft-depth', 'b'], ['c-ink-rail', 'c'],
] as const;
const css = (name: string) => resolve(`docs/ux/part-b/direction-${name}.css`);

async function apply(page: Page, name: string, key: string | undefined) {
  if (key) await page.addStyleTag({ path: css(name) });
  await page.evaluate((k) => { if (k) document.documentElement.dataset.direction = k; else delete document.documentElement.dataset.direction; }, key);
}
async function shoot(page: Page, screen: string) {
  for (const [name, key] of directions) {
    await apply(page, name, key);
    for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
      mkdirSync(`${dir}/${name}`, { recursive: true });
      await page.screenshot({ path: `${dir}/${name}/${screen}-${label}.png` });
    }
  }
  await apply(page, 'current', undefined); await page.setViewportSize({ width: 1440, height: 900 });
}

test('visual directions: unlock, chat with file and call, invite, calls page', async ({ browser }) => {
  test.skip(process.env.UX_DIRECTIONS !== 'true', 'Opt-in: UX_DIRECTIONS=true');
  test.setTimeout(600_000);
  const { alice, bob } = await connectedPair(browser);
  await alice.locator('input[type=file]').setInputFiles({ name: 'Family plan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(80 * 1024, 3) });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 60_000 });
  await alice.locator('.chat-footer textarea').fill('See you at seven. Bringing the plan.');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  await alice.waitForTimeout(1500);
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
  await shoot(alice, '4-calls-page');
  await alice.getByRole('button', { name: 'Chats', exact: true }).click();
  await shoot(alice, '2-chat-file-and-call');
  await alice.locator('.new-conversation').click();
  await shoot(alice, '3-invite');
  await alice.reload();
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await shoot(alice, '1-unlock');
});
