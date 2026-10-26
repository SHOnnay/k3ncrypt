import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { connectedPair } from './usabilityHelpers';

const storageModule = `/@fs${resolve('service/src/storage/secureVault.ts')}`;
const persistenceModule = `/@fs${resolve('service/src/storage/persistence.ts')}`;
const passphrase = 'alpha-family-existing-account-2026';
async function unlock(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
}
async function archive(page: Page, name: string, accept = true) {
  page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.getByRole('button', { name: `Archive conversation ${name}`, exact: true }).last().click();
}
async function protectedDigests(page: Page) {
  return page.evaluate(async ({ storageModule, persistenceModule, passphrase }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
    const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
    try {
      const records = JSON.parse(new TextDecoder().decode(await vault.read('product-session', 'conversations')));
      const peer = records.find((item: { remoteAddress?: string }) => item.remoteAddress);
      const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
      return { identity: await digest(await vault.read('contact-identity', peer.remoteAddress)), history: await digest(await vault.read('product-messages', peer.roomId)) };
    } finally { vault.lock(); }
  }, { storageModule, persistenceModule, passphrase });
}

test('local archive is confirmed, survives unlock, preserves verified identity/history and restores messaging', async ({ browser }) => {
  test.setTimeout(90_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    await alice.locator('#msg-input').fill('History stays encrypted and saved'); await alice.locator('#send-btn').click();
    await expect(bob.locator('#messages-area')).toContainText('History stays encrypted and saved');
    await alice.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(alice.locator('.workspace-contact').filter({ hasText: 'Bob' })).toContainText('Verified on this device');
    const before = await protectedDigests(alice);
    await archive(alice, 'Bob', false);
    await expect(alice.locator('.workspace-contact').filter({ hasText: 'Bob' })).toHaveCount(1);
    await archive(alice, 'Bob');
    await expect(alice.locator('.workspace-contact').filter({ hasText: 'Bob' })).toHaveCount(0);
    await expect(alice.getByRole('region', { name: 'Conversations', exact: true }).locator('.conversation-row').filter({ hasText: 'Bob' })).toHaveCount(0);
    await unlock(alice);
    const archived = alice.locator('details[aria-label="Archived conversations"]');
    await archived.locator('summary').click();
    await expect(archived).toContainText('Bob');
    expect(await protectedDigests(alice)).toEqual(before);
    await archived.getByRole('button', { name: 'Restore conversation Bob', exact: true }).click();
    await expect(alice.locator('.workspace-contact').filter({ hasText: 'Bob' })).toContainText('Verified on this device');
    await alice.locator('.workspace-contact').filter({ hasText: 'Bob' }).click();
    await expect(alice.locator('#messages-area')).toContainText('History stays encrypted and saved');
    await bob.locator('#msg-input').fill('Messaging after local restore'); await bob.locator('#send-btn').click();
    await expect(alice.locator('#messages-area')).toContainText('Messaging after local restore');
  } finally { await a.close(); await b.close(); }
});

test('expired, deleted, unknown and invalid disposable records stay separate and cannot gain trust through archive/restore', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const { a, b, alice } = await connectedPair(browser);
  const unknownRoom = '00000000-0000-4000-8000-000000000091';
  try {
    const deletedRoom = await alice.evaluate(async ({ storageModule, persistenceModule, passphrase, unknownRoom }) => {
      const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
      const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
      const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
      try {
        const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
        const records = JSON.parse(new TextDecoder().decode(await vault.read('product-session', 'conversations')));
        const peer = records.find((item: { remoteAddress?: string }) => item.remoteAddress); peer.updatedAt = Date.now() + 1000;
        records.push({ version: 1, roomId: unknownRoom, controlCapability: 'a'.repeat(43), label: 'Private contact', remoteAddress: 'fixture-unknown-peer', remoteIdentityCommitment: 'K3 ' + 'A'.repeat(43), relationship: 'accepted', bootstrapState: 'ESTABLISHED', updatedAt: 1 });
        records.push({ version: 1, roomId: '00000000-0000-4000-8000-000000000092', controlCapability: 'a'.repeat(43), label: 'Expired test invitation', relationship: 'invitation', pendingInvitationExpiresAt: Date.now() - 1, updatedAt: 1 });
        records.push({ malformed: 'retained synthetic entry' });
        await vault.write('product-session', 'conversations', encode(records));
        await vault.write('conversation-protocol', unknownRoom, encode({ version: 1, mode: 'modern', localAddress: 'fixture-local-address', remoteAddress: 'fixture-unknown-peer', routingProof: 'b'.repeat(43), sessionId: 'fixture-session' }));
        await vault.write('conversation-protocol', '00000000-0000-4000-8000-000000000093', encode({ syntheticOrphan: true }));
        return peer.roomId as string;
      } finally { vault.lock(); }
    }, { storageModule, persistenceModule, passphrase, unknownRoom });
    // Simulate the existing authorized room-status deletion response, without
    // deleting any backend data or altering the contact's pinned identity.
    await alice.route(`**/api/chat-link/status/${deletedRoom}`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"state":"DELETED"}' }));
    await unlock(alice);
    await expect(alice.locator('.workspace-contact')).toHaveCount(0);
    const unavailable = alice.getByRole('region', { name: 'Unavailable saved conversations' });
    await expect(unavailable).toContainText('Room expired or removed');
    await expect(unavailable).toContainText('matching local contact identity is unavailable');
    await expect(unavailable.getByText('CONTACT_REGISTRY_MISSING', { exact: true })).not.toBeVisible();
    await expect(unavailable).toContainText('Invitation expired');
    const invalid = unavailable.locator('.workspace-record').filter({ hasText: 'Invalid saved entry' });
    await expect(invalid.getByRole('button', { name: /^Archive conversation/ })).toHaveCount(0);
    await archive(alice, 'Bob');
    const archived = alice.locator('details[aria-label="Archived conversations"]'); await archived.locator('summary').click();
    await archived.getByRole('button', { name: 'Restore conversation Bob', exact: true }).click();
    await expect(unavailable).toContainText('Bob'); await expect(unavailable).toContainText('Room expired or removed');
    const unknown = unavailable.locator('.workspace-record').filter({ hasText: 'matching local contact identity is unavailable' });
    alice.once('dialog', dialog => dialog.accept()); await unknown.getByRole('button', { name: /^Archive conversation/ }).click();
    await archived.locator('summary').click();
    await archived.getByRole('button', { name: /^Restore conversation Contact/ }).click();
    await expect(unavailable).toContainText('matching local contact identity is unavailable');
    const intact = await alice.evaluate(async ({ storageModule, persistenceModule, passphrase }) => {
      const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
      const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
      const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
      try { return { unknownIdentityAbsent: !await vault.read('contact-identity', 'fixture-unknown-peer'), invalidRetained: new TextDecoder().decode(await vault.read('product-session', 'conversations')).includes('retained synthetic entry') }; }
      finally { vault.lock(); }
    }, { storageModule, persistenceModule, passphrase });
    expect(intact).toEqual({ unknownIdentityAbsent: true, invalidRetained: true });
    await alice.setViewportSize({ width: 360, height: 780 });
    expect(await alice.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await alice.screenshot({ path: testInfo.outputPath('disposable-contact-categories.png') });
  } finally { await a.close(); await b.close(); }
});
