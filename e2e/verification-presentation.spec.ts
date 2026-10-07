import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';
async function security(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.locator('.verification-view')).toBeVisible();
}
async function cameraImage(page: Page, url: string) {
  await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    // Exercise the real local decoder with a synthetic camera frame, not a scan callback bypass.
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(10); const timer = setInterval(() => canvas.getContext('2d')!.drawImage(image, 0, 0), 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    };
  }, url);
}
test('QR primary scanner rejects another identity and requires explicit confirmation for a real match', async ({ browser }) => {
  test.setTimeout(180000); const { a, b, alice, bob } = await connectedPair(browser);
  await security(alice); await alice.locator('.verification-security-details summary').click();
  await alice.getByRole('button', { name: 'Mark unverified', exact: true }).click();
  await alice.getByRole('button', { name: 'Show my QR', exact: true }).click();
  const ownImage = alice.getByAltText('Your verification QR', { exact: true }); await expect(ownImage).toBeVisible(); const aliceQr = await ownImage.getAttribute('src');
  await security(bob); await bob.locator('.verification-security-details summary').click();
  await bob.getByRole('button', { name: 'Mark unverified', exact: true }).click();
  await bob.getByRole('button', { name: 'Show my QR', exact: true }).click();
  const wrongImage = bob.getByAltText('Your verification QR', { exact: true }); await expect(wrongImage).toBeVisible(); const bobQr = await wrongImage.getAttribute('src');
  const mark = bob.getByRole('button', { name: 'Mark as verified', exact: true });
  await bob.bringToFront();
  await cameraImage(bob, bobQr!); await bob.getByRole('button', { name: 'Scan their QR', exact: true }).click();
  await expect(bob.getByText('That code belongs to a different identity.', { exact: true })).toBeVisible({ timeout: 30000 }); await expect(mark).toBeDisabled();
  await cameraImage(bob, aliceQr!); await bob.getByRole('button', { name: 'Scan their QR', exact: true }).click();
  await expect(bob.getByText('Identity matched. Choose Mark as verified to confirm.', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(mark).toBeEnabled(); await expect(bob.locator('.verification-view')).toContainText('Unverified');
  await mark.click(); await bob.getByRole('button', { name: 'Back to chat', exact: true }).click(); await expect(bob.locator('.chat-header')).toContainText('Verified');
  await a.close(); await b.close();
});
