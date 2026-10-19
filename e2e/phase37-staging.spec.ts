import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { connectedPair } from './usabilityHelpers';
const passphrase = 'alpha-family-existing-account-2026';
test('production stage: encrypted offline recovery, unlock and application restart', async ({ browser }) => {
  test.skip(process.env.K3NCRYPT_PHASE37_STAGE !== 'true', 'Explicit disposable production-stage opt-in required');
  test.setTimeout(180000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    await alice.locator('textarea.message-input').fill('Synthetic before restart');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic before restart' })).toBeVisible();
    await b.setOffline(true);
    await alice.locator('textarea.message-input').fill('Synthetic offline recovery');
    const started = Date.now();
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(alice.locator('.message.sent').filter({ hasText: 'Synthetic offline recovery' }).locator('.message-delivery-details summary')).toHaveText('Sending…', { timeout: 15000 });
    console.log('STAGE_SAFE', JSON.stringify({ stage: 'offline-pending-ui-observed', ms: Date.now() - started }));
    await b.setOffline(false);
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic offline recovery' })).toBeVisible({ timeout: 45000 });
    await bob.reload();
    await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await bob.locator('input[type=password]').fill(passphrase);
    await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await bob.locator('.conversation-row').filter({ hasText: 'Alice' }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic before restart' })).toBeVisible({ timeout: 30000 });
    // Fixed container name and origin prevent this fixture from restarting any other service.
    expect(new URL(alice.url()).origin).toBe('https://phase37.localhost:3447');
    const at = Date.now();
    execFileSync('docker', ['restart', 'k3ncrypt-phase37-app'], { stdio: 'ignore' });
    await expect.poll(async () => (await alice.request.get('/api/ready')).status(), { timeout: 30000 }).toBe(200);
    await alice.locator('textarea.message-input').fill('Synthetic after application restart');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic after application restart' })).toBeVisible({ timeout: 60000 });
    console.log('STAGE_SAFE', JSON.stringify({ stage: 'application-restart-to-receipt', ms: Date.now() - at }));
  } finally { await a.close(); await b.close(); }
});

test('production stage: clean offline recipient and authenticated replay', async ({ browser }) => {
  test.skip(process.env.K3NCRYPT_PHASE37_STAGE !== 'true', 'Explicit disposable stage opt-in required');
  test.setTimeout(150000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    // Establish the real encrypted session before taking the recipient offline.
    await alice.locator('textarea.message-input').fill('Synthetic established before clean shutdown');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic established before clean shutdown' })).toBeVisible();
    await bob.close({ runBeforeUnload: true });
    await alice.locator('textarea.message-input').fill('Synthetic clean offline');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    // Existing modern Web UI stays pending until recipient acceptance; it has no Delivered label.
    await expect(alice.locator('.message.sent').filter({ hasText: 'Synthetic clean offline' }).locator('.message-delivery-details summary')).toHaveText('Sending…', { timeout: 15000 });
    const returned = await b.newPage(); await returned.goto('/');
    await returned.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await returned.locator('input[type=password]').fill(passphrase);
    await returned.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await returned.locator('.conversation-row').filter({ hasText: 'Alice' }).click();
    await expect(returned.locator('.message-text').filter({ hasText: 'Synthetic clean offline' })).toBeVisible({ timeout: 45000 });
    await expect(returned.locator('.message-text').filter({ hasText: 'Synthetic clean offline' })).toHaveCount(1);
    await expect(alice.locator('.message.sent').filter({ hasText: 'Synthetic clean offline' }).locator('.message-delivery-details summary')).toHaveText('Sent', { timeout: 30000 });
    console.log('STAGE_SAFE', JSON.stringify({ stage: 'offline-reopen-receipt-and-supported-status', complete: true }));
  } finally { await a.close(); await b.close(); }
});

test('production stage: application restart retains encrypted conversation', async ({ browser }) => {
  test.skip(process.env.K3NCRYPT_PHASE37_STAGE !== 'true', 'Explicit disposable stage opt-in required');
  test.setTimeout(150000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    await alice.locator('textarea.message-input').fill('Synthetic restart control');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic restart control' })).toBeVisible();
    expect(new URL(alice.url()).origin).toBe('https://phase37.localhost:3447');
    const at = Date.now();
    execFileSync('docker', ['restart', 'k3ncrypt-phase37-app'], { stdio: 'ignore' });
    await expect.poll(async () => (await alice.request.get('/api/ready')).status(), { timeout: 30000 }).toBe(200);
    await alice.locator('textarea.message-input').fill('Synthetic independent restart receipt');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic independent restart receipt' })).toBeVisible({ timeout: 60000 });
    await bob.reload();
    await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await bob.locator('input[type=password]').fill(passphrase);
    await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await bob.locator('.conversation-row').filter({ hasText: 'Alice' }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Synthetic restart control' })).toBeVisible({ timeout: 30000 });
    console.log('STAGE_SAFE', JSON.stringify({ stage: 'restart-and-unlock', ms: Date.now() - at }));
  } finally { await a.close(); await b.close(); }
});
