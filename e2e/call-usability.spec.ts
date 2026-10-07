import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
async function launch(page: Page, mode: 'audio' | 'video') {
  await page.getByRole('button', { name: 'Calls', exact: true }).click();
  const button = page.getByRole('button', { name: `Start ${mode} call`, exact: true });
  await expect(button).toBeEnabled(); await button.click();
}
async function idle(page: Page) {
  await expect(page.locator('.call-info')).not.toBeVisible();
  await page.getByRole('button', { name: 'Calls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start audio call', exact: true })).toBeEnabled();
  await expect(page.getByText('A call is already in progress.', { exact: true })).not.toBeVisible();
}
test('voice/video both directions, terminal cleanup, immediate second calls and local history', async ({ browser }) => {
  test.setTimeout(240000);
  const { a, b, alice, bob } = await connectedPair(browser);
  for (const [caller, receiver, mode] of [[alice, bob, 'audio'], [bob, alice, 'audio'], [alice, bob, 'video'], [bob, alice, 'video']] as const) {
    await launch(caller, mode); await receiver.getByRole('button', { name: 'Accept call', exact: true }).click();
    await expect(caller.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
    await expect(receiver.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
    if (mode === 'video') { await expect(caller.getByLabel('Remote video', { exact: true })).toBeVisible(); await expect(receiver.getByLabel('Remote video', { exact: true })).toBeVisible(); }
    await receiver.getByRole('button', { name: 'End call', exact: true }).click();
    await idle(caller); await idle(receiver);
    for (const page of [caller, receiver]) { await page.getByRole('button', { name: 'Chats', exact: true }).click(); await expect(page.locator('[aria-label="Local call history"]').filter({ hasText: mode === 'video' ? 'Video call' : 'Voice call' })).not.toHaveCount(0); }
  }
  for (const [caller, receiver, mode] of [[alice, bob, 'audio'], [bob, alice, 'video']] as const) {
    await launch(caller, mode); await receiver.getByRole('button', { name: 'Decline call', exact: true }).click();
    await idle(caller); await idle(receiver);
    await launch(caller, mode); await expect(receiver.getByRole('button', { name: 'Accept call', exact: true })).toBeVisible(); await caller.getByRole('button', { name: 'Cancel call', exact: true }).click();
    await idle(caller); await idle(receiver);
  }
  // Exercise the real permission-denial cleanup path without needing real hardware.
  await bob.evaluate(() => { const media = navigator.mediaDevices; const original = media.getUserMedia.bind(media); Object.assign(window, { restoreTestCapture: () => { media.getUserMedia = original; } }); media.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }; });
  await launch(alice, 'audio'); await bob.getByRole('button', { name: 'Accept call', exact: true }).click();
  await idle(alice); await idle(bob);
  await bob.getByRole('button', { name: 'Chats', exact: true }).click(); await expect(bob.getByLabel('Local call history').filter({ hasText: 'Failed call' })).not.toHaveCount(0);
  await bob.evaluate(() => { (window as Window & { restoreTestCapture?: () => void }).restoreTestCapture?.(); });
  await launch(bob, 'audio'); await alice.getByRole('button', { name: 'Accept call', exact: true }).click();
  await expect(bob.locator('#call-status')).toHaveText('Connected', { timeout: 20000 }); await bob.getByRole('button', { name: 'End call', exact: true }).click();
  await idle(alice); await idle(bob);
  for (const page of [alice, bob]) { await page.getByRole('button', { name: 'Chats', exact: true }).click(); await expect(page.getByLabel('Local call history').filter({ hasText: 'Declined call' })).not.toHaveCount(0); await expect(page.getByLabel('Local call history').filter({ hasText: 'Canceled call' })).not.toHaveCount(0); }
  await expect(alice.getByLabel('Local call history').filter({ hasText: 'Missed video call' })).not.toHaveCount(0);
  await expect(bob.getByLabel('Local call history').filter({ hasText: 'Missed voice call' })).not.toHaveCount(0);
  await bob.reload(); await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await bob.locator('input[type=password]').fill('alpha-family-existing-account-2026'); await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(bob.getByLabel('Local call history')).not.toHaveCount(0); await idle(bob);
  await a.close(); await b.close();
});
