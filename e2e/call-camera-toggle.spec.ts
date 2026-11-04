import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A1. Invariant: turning the camera off and on again restores video for both people, every time.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

/** Frames are really arriving: the element has a live video track and its playback time advances. */
async function playing(page: Page, label: string) {
  await expect.poll(async () => page.evaluate(async (name) => {
    const video = document.querySelector(`video[aria-label="${name}"]`) as HTMLVideoElement | null;
    const stream = video?.srcObject as MediaStream | null;
    if (!video || !stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled) || !video.videoWidth) return false;
    const start = video.currentTime; await new Promise((resolve) => setTimeout(resolve, 400));
    return video.currentTime > start;
  }, label), { timeout: 20_000, message: `${label} should be playing` }).toBe(true);
}

test('camera off and on twice restores local preview and remote video', async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice, bob } = await connectedPair(browser);
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start video call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  await playing(alice, 'Local video preview');
  await playing(bob, 'Remote video');

  for (const round of [1, 2]) {
    await alice.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Turn camera on', exact: true })).toBeVisible();
    await expect(alice.locator('.call-video-indicator')).toHaveText('Camera off');
    // Part A2 bug 2: the other side shows Camera off with the contact's avatar, not a frozen last frame.
    const remoteOff = bob.locator('.call-video-placeholder--remote-camera-off');
    await expect(remoteOff, `round ${round}`).toContainText('Camera off', { timeout: 15_000 });
    await expect(remoteOff.locator('.avatar')).toBeVisible();
    await alice.getByRole('button', { name: 'Turn camera on', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Turn camera off', exact: true }), `round ${round}`).toBeVisible();
    await expect(alice.locator('.call-error')).toHaveCount(0);
    await playing(alice, 'Local video preview');
    await playing(bob, 'Remote video');
    await expect(bob.locator('.call-video-placeholder')).toHaveCount(0);
  }
  await expect(bob.locator('#call-status')).toHaveText('Connected');
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
});
