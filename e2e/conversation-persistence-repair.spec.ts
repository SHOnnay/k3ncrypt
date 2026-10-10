import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { connectedPair, create, invite } from './usabilityHelpers';

const storageModule = `/@fs${resolve('service/src/storage/secureVault.ts')}`;
const persistenceModule = `/@fs${resolve('service/src/storage/persistence.ts')}`;
const sessionModule = `/@fs${resolve('client/src/product/sessionStore.ts')}`;
const eligibilityModule = `/@fs${resolve('client/src/product/conversationEligibility.ts')}`;
const passphrase = 'alpha-family-existing-account-2026';

test('real encrypted IndexedDB survives 1200 competing mutations across two pages and a fresh unlock', async ({ context }) => {
  test.setTimeout(180000);
  const pages = [await context.newPage(), await context.newPage()];
  for (const [index, page] of pages.entries()) {
    await page.goto('/');
    await page.evaluate(async ({ storageModule, persistenceModule, passphrase, initialize }) => {
      const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
      const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
      const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence());
      if (initialize) await vault.initializeWithPassphrase(passphrase); else await vault.unlock(passphrase);
      Object.assign(globalThis, { persistenceTestVault: vault });
    }, { storageModule, persistenceModule, passphrase, initialize: index === 0 });
  }
  const mutate = (page: Page, round: number, phase: 'create' | 'update') => page.evaluate(async ({ sessionModule, round, phase }) => {
    const { saveConversationDescriptor, updateConversationDescriptor, removeConversationDescriptor } = await import(/* @vite-ignore */ sessionModule);
    const vault = (globalThis as typeof globalThis & { persistenceTestVault: import('../service/src/storage/secureVault').BrowserSecureStorage }).persistenceTestVault;
    const rooms = Array.from({ length: 2 }, (_, i) => `00000000-0000-4000-8000-${String(round * 4 + i + 1).padStart(12, '0')}`);
    if (phase === 'create') {
      await Promise.all(rooms.map(roomId => saveConversationDescriptor(vault, { version: 1, roomId, controlCapability: 'a'.repeat(43), label: 'Fixture', updatedAt: round })));
    } else {
      await Promise.all(rooms.flatMap((roomId, index) => index === 0 && round % 2 === 0
        ? [removeConversationDescriptor(vault, roomId), updateConversationDescriptor(vault, roomId, { label: 'Fixture updated' }).catch((error: { safeDiagnosticCode?: string }) => { if (error.safeDiagnosticCode !== 'CONVERSATION_REMOVED') throw new Error('Unexpected mutation failure.'); })]
        : [updateConversationDescriptor(vault, roomId, { label: 'Fixture updated' }), updateConversationDescriptor(vault, roomId, { localNickname: 'Retained nickname' })]));
    }
    return rooms;
  }, { sessionModule, round, phase });
  // Adjacent fixture groups use separate room IDs; both tabs contend on the same encrypted index.
  for (let round = 0; round < 100; round++) {
    await Promise.all([mutate(pages[0], round * 2, 'create'), mutate(pages[1], round * 2 + 1, 'create')]);
    await Promise.all([mutate(pages[0], round * 2, 'update'), mutate(pages[1], round * 2 + 1, 'update')]);
  }
  await pages[0].close(); await pages[1].close();
  const reopened = await context.newPage(); await reopened.goto('/');
  const result = await reopened.evaluate(async ({ storageModule, persistenceModule, sessionModule, eligibilityModule, passphrase }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
    const { readConversationDescriptors, saveConversationDescriptor } = await import(/* @vite-ignore */ sessionModule);
    const { diagnoseOrphanedConversationRecords } = await import(/* @vite-ignore */ eligibilityModule);
    const persistence = new IndexedDbVaultPersistence(); const vault = new BrowserSecureStorage(persistence); await vault.unlock(passphrase);
    const saved = await readConversationDescriptors(vault);
    const expected = new Set(Array.from({ length: 200 }, (_, round) => [0, 1].filter(i => !(i === 0 && round % 2 === 0)).map(i => `00000000-0000-4000-8000-${String(round * 4 + i + 1).padStart(12, '0')}`)).flat());
    let removalGuard = false;
    try { await saveConversationDescriptor(vault, { version: 1, roomId: '00000000-0000-4000-8000-000000000001', controlCapability: 'a'.repeat(43), label: 'Stale', updatedAt: 1 }); }
    catch (error) { removalGuard = (error as { safeDiagnosticCode?: string }).safeDiagnosticCode === 'CONVERSATION_REMOVED'; }
    const persisted = await persistence.readRecord('product-session:conversations');
    await vault.write('conversation-protocol', '00000000-0000-4000-8000-999999999999', new TextEncoder().encode('synthetic orphan fixture').buffer);
    const orphanDiagnostic = await diagnoseOrphanedConversationRecords(vault);
    return { count: saved.length, exactRooms: saved.every((item: { roomId: string }) => expected.has(item.roomId)) && saved.length === expected.size,
      preserved: saved.every((item: { label: string; localNickname?: string; controlCapability: string }) => item.label === 'Fixture updated' && item.localNickname === 'Retained nickname' && item.controlCapability === 'a'.repeat(43)),
      encrypted: !persisted?.includes('Retained nickname'), removalGuard, orphanDiagnostic: orphanDiagnostic.available && orphanDiagnostic.roomIds.length === 1 && !orphanDiagnostic.truncated };
  }, { storageModule, persistenceModule, sessionModule, eligibilityModule, passphrase });
  expect(result).toEqual({ count: 300, exactRooms: true, preserved: true, encrypted: true, removalGuard: true, orphanDiagnostic: true });
});

async function unlock(page: Page) {
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
}
async function open(page: Page, name: string) {
  await page.evaluate(() => { document.documentElement.dataset.k3ncryptConversationOpen = ''; });
  await page.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: name }).click();
  try { await expect.poll(() => page.locator('html').getAttribute('data-k3ncrypt-conversation-open'), { timeout: 30000 }).toMatch(/^(connected|same-room)$/); }
  catch (error) {
    const code = await page.locator('.safe-diagnostic-details code').textContent().catch(() => 'no code');
    console.log('PERSISTENCE_SAFE_FAILURE', code);
    throw error;
  }
  await expect(page.locator('.chat-header')).toContainText(name);
  await expect(page.getByRole('textbox', { name: 'Write a message', exact: true })).toBeEnabled({ timeout: 30000 });
}

test('Alice/Bob/Carol descriptors survive switching, 503, timeout, offline refresh/unlock and one broken room', async ({ browser }) => {
  test.setTimeout(240000);
  const { a, b, alice, bob } = await connectedPair(browser, true);
  const c = await browser.newContext(); const carol = await c.newPage();
  try {
    await create(carol, 'Carol'); const invitation = await invite(alice);
    await carol.locator('.new-conversation').click(); await carol.getByRole('button', { name: 'I have an invitation' }).click();
    await carol.locator('#channel-hash').fill(invitation); await carol.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(alice.locator('.chat-header')).toContainText('Carol', { timeout: 30000 });
    await expect(carol.locator('.chat-header')).toContainText('Alice', { timeout: 30000 });
    for (let round = 0; round < 3; round++) { await open(alice, 'Bob'); await open(alice, 'Carol'); }
    await open(alice, 'Bob');
    await alice.getByRole('textbox', { name: 'Write a message', exact: true }).fill('Persistence acceptance fixture');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.locator('.message-text').filter({ hasText: 'Persistence acceptance fixture' })).toBeVisible();
    await alice.route('**/api/chat-link/status/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"not_ready"}' }));
    await alice.reload(); await unlock(alice);
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Bob' })).toBeVisible();
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Carol' })).toBeVisible();
    await expect.poll(() => alice.locator('.conversation-preview').filter({ hasText: 'Disconnected' }).count()).toBeGreaterThan(0);
    await alice.unroute('**/api/chat-link/status/**'); await open(alice, 'Bob');
    await expect(alice.locator('.message-text').filter({ hasText: 'Persistence acceptance fixture' })).toBeVisible();
    await alice.route('**/api/chat-link/status/**', async route => {
      await new Promise<void>(resolve => setTimeout(resolve, 11000));
      await route.abort().catch((error: Error) => { if (!error.message.includes('Route is already handled')) throw error; });
    });
    await alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Carol' }).click();
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Carol' })).toContainText('Disconnected', { timeout: 15000 });
    await alice.unroute('**/api/chat-link/status/**'); await open(alice, 'Carol');
    // Match HTTP API paths only: a broad glob also blocks Vite's service/src/api imports.
    const apiOnly = (url: URL) => url.pathname.startsWith('/api/');
    await alice.route(apiOnly, route => route.abort('internetdisconnected'));
    await alice.reload(); await unlock(alice);
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Bob' })).toBeVisible();
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Carol' })).toBeVisible();
    await expect(alice.locator('.conversation-preview').filter({ hasText: 'Disconnected' })).toHaveCount(1);
    await alice.unroute(apiOnly); await open(alice, 'Bob');
    // Simulate one missing local session in a disposable fixture without modifying descriptors or identities.
    await alice.evaluate(async ({ storageModule, persistenceModule, sessionModule, passphrase }) => {
      const { BrowserSecureStorage } = await import(/* @vite-ignore */ storageModule);
      const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ persistenceModule);
      const { readConversationDescriptors } = await import(/* @vite-ignore */ sessionModule);
      const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
      const descriptors = await readConversationDescriptors(vault);
      const carol = descriptors.find((item: { remoteDisplayName?: string }) => item.remoteDisplayName === 'Carol');
      if (!carol) throw new Error('Fixture room missing.');
      await vault.delete('vodozemac-session', carol.roomId);
    }, { storageModule, persistenceModule, sessionModule, passphrase });
    await alice.reload(); await unlock(alice);
    await expect(alice.locator('.unavailable-conversation-action').filter({ hasText: 'Carol' })).toContainText('Local records incomplete');
    await open(alice, 'Bob');
    await expect(alice.locator('.message-text').filter({ hasText: 'Persistence acceptance fixture' })).toBeVisible();
    await expect(alice.locator('.conversation-row, .unavailable-conversation-action').filter({ hasText: 'Carol' })).toBeVisible();
  } finally { await a.close(); await b.close(); await c.close(); }
});
