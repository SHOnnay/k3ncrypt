import { test, expect } from '@playwright/test';
import { create } from './usabilityHelpers';

// Part A2 bug 5. Invariant: the profile name block is vertically centred with the avatar.
for (const width of [1440, 1024]) test(`sidebar profile name is centred with its avatar at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await create(page, 'Alice');
  const profile = page.locator('.sidebar-profile');
  const avatar = await profile.locator('.avatar').boundingBox();
  const name = await profile.locator('> span:not(.avatar)').boundingBox();
  const text = await profile.locator('strong').boundingBox();
  if (!avatar || !name || !text) throw new Error('Profile elements not rendered.');
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2;
  console.log(JSON.stringify({ avatar, name, text }));
  if (process.env.PROFILE_SHOT) await profile.screenshot({ path: process.env.PROFILE_SHOT, scale: 'device' });
  expect(Math.abs(centre(avatar) - centre(name))).toBeLessThanOrEqual(1);
});
