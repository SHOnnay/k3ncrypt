import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
async function launch(page: Page, mode: 'audio' | 'video') {
  await page.getByRole('button', { name: 'Calls', exact: true }).click();
  const button = page.getByRole('button', { name: `Start ${mode} call`, exact: true });
  await expect(button).toBeEnabled(); await button.click();
}
async function activeTransport(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => string | undefined }).__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?.());
}
async function warmRoom(page: Page, text: string) {
  await page.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await page.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary')).toHaveText('Sent', { timeout: 30_000 });
}
async function reloadUnlocked(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
}
async function idle(page: Page) {
  await expect(page.locator('.call-info')).not.toBeVisible();
  await page.getByRole('button', { name: 'Calls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start audio call', exact: true })).toBeEnabled();
  await expect(page.getByText('A call is already in progress.', { exact: true })).not.toBeVisible();
}
async function acceptIncoming(receiver: Page, caller: Page, label: string) {
  try { await receiver.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 30000 }); }
  catch (error) {
    const callerState = await caller.locator('#call-status').innerText().catch(() => 'none');
    const receiverState = await receiver.locator('#call-status').innerText().catch(() => 'none');
    const callerError = await caller.locator('.call-error').innerText().catch(() => 'none');
    const receiverError = await receiver.locator('.call-error').innerText().catch(() => 'none');
    console.log('CALL_INCOMING_FAILURE', `case=${label};caller=${callerState};receiver=${receiverState};callerError=${callerError};receiverError=${receiverError}`);
    throw error;
  }
  await receiver.getByRole('button', { name: 'Accept call', exact: true }).click();
}
test('voice/video both directions, terminal cleanup, immediate second calls and local history', async ({ browser }) => {
  test.setTimeout(240000);
  const muxEnabled = process.env.PLAYWRIGHT_MUX_STAGE1 === 'true';
  const { a, b, alice, bob } = await connectedPair(browser, muxEnabled);
  if (muxEnabled) {
    await warmRoom(alice, 'Mux call compatibility warmup Alice to Bob');
    await warmRoom(bob, 'Mux call compatibility warmup Bob to Alice');
    await reloadUnlocked(alice);
    await reloadUnlocked(bob);
    for (const [page, name] of [[alice, 'Bob'], [bob, 'Alice']] as const) {
      await page.locator('.conversation-row').filter({ hasText: name }).click();
      await expect(page.locator('.chat-header')).toContainText(name);
      await expect.poll(() => activeTransport(page), { timeout: 30_000 }).toBe('multiplexed');
    }
  }
  for (const [caller, receiver, mode, direction] of [[alice, bob, 'audio', 'A-to-B'], [bob, alice, 'audio', 'B-to-A'], [alice, bob, 'video', 'A-to-B'], [bob, alice, 'video', 'B-to-A']] as const) {
    console.log('CALL_CASE', `${direction}:${mode}:connect`);
    await launch(caller, mode); await acceptIncoming(receiver, caller, `${direction}:${mode}:connect`);
    await expect(caller.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
    await expect(receiver.locator('#call-status')).toHaveText('Connected', { timeout: 20000 });
    if (mode === 'video') { await expect(caller.getByLabel('Remote video', { exact: true })).toBeVisible(); await expect(receiver.getByLabel('Remote video', { exact: true })).toBeVisible(); }
    await receiver.getByRole('button', { name: 'End call', exact: true }).click();
    await idle(caller); await idle(receiver);
    for (const page of [caller, receiver]) { await page.getByRole('button', { name: 'Chats', exact: true }).click(); await expect(page.locator('[aria-label="Local call history"]').filter({ hasText: mode === 'video' ? 'Video call' : 'Voice call' })).not.toHaveCount(0); }
  }
  for (const [caller, receiver, mode, direction] of [[alice, bob, 'audio', 'A-to-B'], [bob, alice, 'video', 'B-to-A']] as const) {
    console.log('CALL_CASE', `${direction}:${mode}:decline-cancel`);
    await launch(caller, mode); await receiver.getByRole('button', { name: 'Decline call', exact: true }).click();
    await idle(caller); await idle(receiver);
    await launch(caller, mode); await receiver.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 30000 }); await caller.getByRole('button', { name: 'Cancel call', exact: true }).click();
    await idle(caller); await idle(receiver);
  }
  // Exercise the real permission-denial cleanup path without needing real hardware.
  await bob.evaluate(() => { const media = navigator.mediaDevices; const original = media.getUserMedia.bind(media); Object.assign(window, { restoreTestCapture: () => { media.getUserMedia = original; } }); media.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }; });
  console.log('CALL_CASE', 'A-to-B:audio:media-denied');
  await launch(alice, 'audio'); await acceptIncoming(bob, alice, 'A-to-B:audio:media-denied');
  await idle(alice); await idle(bob);
  await bob.getByRole('button', { name: 'Chats', exact: true }).click(); await expect(bob.getByLabel('Local call history').filter({ hasText: 'Failed call' })).not.toHaveCount(0);
  await bob.evaluate(() => { (window as Window & { restoreTestCapture?: () => void }).restoreTestCapture?.(); });
  console.log('CALL_CASE', 'B-to-A:audio:second-call');
  await launch(bob, 'audio'); await acceptIncoming(alice, bob, 'B-to-A:audio:second-call');
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
