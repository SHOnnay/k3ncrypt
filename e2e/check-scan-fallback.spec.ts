import { test, expect, type Page } from '@playwright/test';
import { uncheckedPair } from './usabilityHelpers';

// UX A13. Invariant: if no code is read within 15 s, the scanner suggests comparing numbers instead.
// Camera-free: the "camera" is a canvas stream showing nothing readable.
async function blankCamera(page: Page) {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas unavailable.');
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(10); const timer = setInterval(() => { context.fillStyle = '#ddd'; context.fillRect(0, 0, 320, 240); }, 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    };
  });
}

test('no read for 15 s suggests Show numbers instead, which opens the number comparison', async ({ browser }) => {
  test.setTimeout(120_000);
  const { bob } = await uncheckedPair(browser);
  await bob.locator('.chat-header').getByRole('button', { name: 'Check', exact: true }).click();
  await bob.getByRole('button', { name: 'No', exact: true }).click();
  await bob.getByRole('button', { name: 'Yes, we’re together', exact: true }).click();
  await blankCamera(bob);
  await bob.getByRole('button', { name: 'Start camera', exact: true }).click();
  const suggestion = bob.locator('.scan-fallback');
  await expect(suggestion).toHaveCount(0);
  await expect(suggestion).toContainText('Can’t read the code?', { timeout: 20_000 });
  await suggestion.getByRole('button', { name: 'Show numbers instead', exact: true }).click();
  await expect(bob.getByRole('region', { name: 'Compare numbers' })).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Stop camera', exact: true })).toHaveCount(0);
});
