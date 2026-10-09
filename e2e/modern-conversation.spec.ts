import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { parseModernInviteInput } from '../client/src/utils/urlHash';
import { invite } from './usabilityHelpers';

const PASSPHRASE = 'paper-ink-private-room-2026';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_CLIENT_PORT ?? '43102'}`;

const captureOutbound = (page: Page, bodies: string[]) => {
  page.on('request', (request) => { if (request.method() !== 'GET') bodies.push(request.postData() ?? ''); });
  page.on('websocket', (socket) => { socket.on('framesent', (frame) => bodies.push(String(frame.payload))); });
};

async function open(browser: Browser, link = BASE_URL): Promise<{ context: BrowserContext; page: Page; outbound: string[] }> {
  const context = await browser.newContext();
  await context.addInitScript(() => { (window as Window & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  const page = await context.newPage();
  const outbound: string[] = [];
  captureOutbound(page, outbound);
  page.on('response', (response) => { if (!response.ok()) console.log(`HTTP ${response.status()} ${new URL(response.url()).pathname}${response.status() === 429 ? ` retry-after=${response.headers()['retry-after'] ?? 'missing'}` : ''}`); });
  await page.goto(link);
  await expect(page.locator('#show-join-hash')).toBeVisible();
  return { context, page, outbound };
}

async function resume(context: BrowserContext, link: string, outbound: string[] = [], displayName = 'Invitee'): Promise<Page> {
  const page = await context.newPage();
  captureOutbound(page, outbound);
  await page.goto(link);
  const unlockButton = page.getByRole('button', { name: 'Unlock this device' });
  const invitationButton = page.getByRole('button', { name: 'I have an invitation' });
  await expect(unlockButton.or(invitationButton).first()).toBeVisible();
  if (await unlockButton.isVisible()) {
    await page.getByRole('button', { name: 'Unlock this device' }).click();
    await page.locator('input[type="password"]').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock account' }).click();
  } else {
    await page.getByRole('button', { name: 'I have an invitation' }).click();
    await expect(page.locator('#channel-hash')).toHaveValue(/invite=/);
    const name = page.getByRole('textbox', { name: 'Display name', exact: true });
    if (await name.isVisible()) await name.fill(displayName);
    await page.getByLabel('Choose a passphrase', { exact: true }).fill(PASSPHRASE);
    const confirmation = page.getByLabel('Confirm your passphrase', { exact: true });
    if (await confirmation.isVisible()) await confirmation.fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.locator('#chat-container')).toBeVisible();
  return page;
}

test('modern private contact works after offline recipient and both browser restarts', async ({ browser }) => {
  test.setTimeout(120_000);
  const bob = await open(browser);
  await bob.page.getByRole('button', { name: 'Create your private account' }).click();
  await bob.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Bob');
  await bob.page.locator('#local-passphrase').fill(PASSPHRASE);
  await bob.page.locator('#local-passphrase-confirm').fill(PASSPHRASE);
  const creation = bob.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await bob.page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await creation).status()).toBe(200);
  const invitation = bob.page.getByRole('textbox', { name: 'Private invitation' });
  await expect(invitation).toHaveValue(/#invite=[A-Za-z0-9_-]+/);
  const link = await invitation.inputValue();
  expect(parseModernInviteInput(link)).not.toBeNull();
  await bob.page.getByRole('button', { name: 'Continue to your chats' }).click();
  await bob.page.close({ runBeforeUnload: true });

  const alice = await open(browser, link);
  await alice.page.getByRole('button', { name: 'I have an invitation' }).click();
  await expect(alice.page.locator('#channel-hash')).toHaveValue(/invite=/);
  await alice.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice');
  await alice.page.getByLabel('Choose a passphrase', { exact: true }).fill(PASSPHRASE);
  await alice.page.getByLabel('Confirm your passphrase', { exact: true }).fill(PASSPHRASE);
  await alice.page.getByRole('button', { name: 'Continue' }).click();
  await expect(alice.page.locator('#chat-container')).toBeVisible();
  await alice.page.locator('#msg-input').fill('hello while you were away');
  await alice.page.locator('#send-btn').click();

  const bobReturned = await resume(bob.context, link, bob.outbound);
  await expect(bobReturned.locator('#messages-area')).toContainText('hello while you were away', { timeout: 20_000 });
  await bobReturned.getByRole('button', { name: 'Open settings' }).click();
  await bobReturned.getByRole('button', { name: 'Security' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Confirm you are really connected to Alice.');
  await expect(bobReturned.locator('.verification-view')).toContainText('Unverified');
  const bobFingerprint = await bobReturned.locator('.verification-code').first().textContent();
  await alice.page.getByRole('button', { name: 'Open settings' }).click();
  await alice.page.getByRole('button', { name: 'Security' }).click();
  await expect(alice.page.locator('.verification-code').last()).toHaveText(bobFingerprint ?? '');
  await alice.page.getByRole('button', { name: 'Close settings' }).click();
  const markVerified = bobReturned.getByRole('button', { name: 'Mark as verified' });
  await expect(markVerified).toBeDisabled();
  await bobReturned.getByRole('button', { name: 'Compare security code', exact: true }).click();
  await bobReturned.getByRole('button', { name: 'Codes match' }).click();
  await expect(markVerified).toBeEnabled();
  await bobReturned.getByRole('button', { name: 'Mark as verified' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Verified');
  await bobReturned.getByRole('button', { name: 'Back to settings' }).click();
  await bobReturned.getByRole('button', { name: 'Security' }).click();
  await expect(bobReturned.locator('.verification-view')).toContainText('Verified');
  await bobReturned.getByRole('button', { name: 'Close settings' }).click();
  await bobReturned.locator('#msg-input').fill('I am here now');
  await bobReturned.locator('#send-btn').click();
  await expect(alice.page.locator('#messages-area')).toContainText('I am here now');

  await bobReturned.close({ runBeforeUnload: true });
  await alice.page.close({ runBeforeUnload: true });
  const bobAgain = await resume(bob.context, link);
  const aliceAgain = await resume(alice.context, link);
  await bobAgain.getByRole('button', { name: 'Open settings' }).click();
  await bobAgain.getByRole('button', { name: 'Security' }).click();
  await expect(bobAgain.locator('.verification-view')).toContainText('Verified');
  await expect(bobAgain.locator('.verification-code').first()).toHaveText(bobFingerprint ?? '');
  await bobAgain.getByRole('button', { name: 'Close settings' }).click();
  await aliceAgain.locator('#msg-input').fill('after restart');
  await aliceAgain.locator('#send-btn').click();
  await expect(bobAgain.locator('#messages-area')).toContainText('after restart');
  await bobAgain.locator('#msg-input').fill('still private');
  await bobAgain.locator('#send-btn').click();
  await expect(aliceAgain.locator('#messages-area')).toContainText('still private');
  for (const text of ['hello while you were away', 'I am here now']) {
    expect(alice.outbound.join('\n')).not.toContain(text);
    expect(bob.outbound.join('\n')).not.toContain(text);
  }
  for (const page of [aliceAgain, bobAgain]) {
    const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(browserStorage).not.toContain('hello while you were away');
    expect(browserStorage).not.toContain(PASSPHRASE);
  }
  await bob.context.close();
  await alice.context.close();
});

test('inviter can stay offline during acceptance and resume the pending first contact', async ({ browser }) => {
  test.setTimeout(150_000);
  const alice = await open(browser);
  await alice.page.getByRole('button', { name: 'Create your private account' }).click();
  await alice.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice');
  await alice.page.locator('#local-passphrase').fill(PASSPHRASE);
  await alice.page.locator('#local-passphrase-confirm').fill(PASSPHRASE);
  const creation = alice.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await alice.page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await creation).status()).toBe(200);
  const invitation = await alice.page.getByRole('textbox', { name: 'Private invitation' }).inputValue();
  expect(parseModernInviteInput(invitation)?.version).toBe(2);
  await alice.page.getByRole('button', { name: 'Continue to your chats' }).click();

  // Closing Alice's only page disconnects its authenticated room transport while
  // retaining the browser context's encrypted IndexedDB vault for a later resume.
  await alice.page.close({ runBeforeUnload: true });

  const bob = await open(browser);
  await bob.page.close();
  const bobPage = await resume(bob.context, invitation, bob.outbound, 'Bob');
  await expect(bobPage.locator('#chat-container')).toBeVisible();
  await expect(bobPage.locator('.conversation-row')).toContainText('Waiting for contact to accept');

  const aliceReturned = await resume(alice.context, invitation, alice.outbound, 'Alice');
  await expect(aliceReturned.locator('#chat-container')).toBeVisible();
  const bobRow = aliceReturned.locator('.conversation-row').filter({ hasText: 'Bob' });
  await expect(bobRow).toHaveCount(1);
  await bobRow.click();
  await expect(aliceReturned.locator('.chat-header')).toBeVisible();
  await expect(aliceReturned.locator('.chat-header')).toContainText(/Bob|Contact · [A-F0-9]{4}/, { timeout: 30_000 });

  await aliceReturned.locator('#msg-input').fill('Alice resumed and accepted the pending introduction');
  await aliceReturned.locator('#send-btn').click();
  await expect(bobPage.locator('#messages-area')).toContainText('Alice resumed and accepted the pending introduction', { timeout: 30_000 });
  await bobPage.locator('#msg-input').fill('Bob confirms the resumed session');
  await bobPage.locator('#send-btn').click();
  await expect(aliceReturned.locator('#messages-area')).toContainText('Bob confirms the resumed session', { timeout: 30_000 });

  await bob.context.close();
  await alice.context.close();
});

test('recipient IndexedDB abort preserves the first-prekey account and does not ACK before replay succeeds', async ({ browser }) => {
  test.setTimeout(180_000);
  const alice = await open(browser);
  await alice.page.getByRole('button', { name: 'Create your private account' }).click();
  await alice.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice');
  await alice.page.locator('#local-passphrase').fill(PASSPHRASE);
  await alice.page.locator('#local-passphrase-confirm').fill(PASSPHRASE);
  const creation = alice.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await alice.page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await creation).status()).toBe(200);
  const invitation = await alice.page.getByRole('textbox', { name: 'Private invitation' }).inputValue();
  const aliceInvitation = parseModernInviteInput(invitation);
  expect(aliceInvitation?.version).toBe(2);
  await alice.page.getByRole('button', { name: 'Continue to your chats' }).click();
  const bob = await open(browser);
  await bob.page.close();
  await expect.poll(() => alice.page.evaluate(async () => {
    const hook = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ROOM_LIFECYCLE__?: () => Promise<{ selectedRoom?: string; selectedConversationRoom?: string; selectedTransportRoom?: string }> }).__K3NCRYPT_TEST_ROOM_LIFECYCLE__;
    const state = await hook?.();
    return [state?.selectedRoom, state?.selectedConversationRoom, state?.selectedTransportRoom];
  })).toEqual([aliceInvitation?.roomId, aliceInvitation?.roomId, aliceInvitation?.roomId]);
  await alice.page.waitForTimeout(1_000);
  await alice.page.evaluate(async (modulePath) => {
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ modulePath) as { IndexedDbVaultPersistence: new () => { compareAndSwapRecords(updates: Array<{ key: string; expected: string | undefined }>): Promise<boolean> } };
    const testWindow = window as Window & { __bootstrapAbortArmed?: boolean; __bootstrapAbortTriggered?: boolean; __bootstrapTransactionAborted?: boolean; __bootstrapAccountAtCas?: unknown; __bootstrapDirectAccountWrites?: number; __bootstrapAccountCasAfterAbort?: number; __bootstrapAccountCasKeys?: string[]; __bootstrapRetryWaiting?: boolean; __bootstrapReleaseRetry?: () => void };
    testWindow.__bootstrapAbortArmed = true;
    testWindow.__bootstrapAbortTriggered = false;
    testWindow.__bootstrapTransactionAborted = false;
    testWindow.__bootstrapDirectAccountWrites = 0;
    testWindow.__bootstrapAccountCasAfterAbort = 0;
    const prototype = IndexedDbVaultPersistence.prototype;
    const original = prototype.compareAndSwapRecords;
    const originalWrite = (prototype as unknown as { writeRecord(key: string, value: string): Promise<void> }).writeRecord;
    (prototype as unknown as { writeRecord(key: string, value: string): Promise<void> }).writeRecord = async function (key, value) {
      if (testWindow.__bootstrapAbortTriggered && key === 'vodozemac-account:local') testWindow.__bootstrapDirectAccountWrites = (testWindow.__bootstrapDirectAccountWrites ?? 0) + 1;
      return originalWrite.call(this, key, value);
    };
    prototype.compareAndSwapRecords = async function (updates) {
      const accountUpdate = updates.find((item) => item.key === 'vodozemac-account:local');
      if (testWindow.__bootstrapAbortTriggered && accountUpdate && !testWindow.__bootstrapAbortArmed) {
        testWindow.__bootstrapAccountCasAfterAbort = (testWindow.__bootstrapAccountCasAfterAbort ?? 0) + 1;
        testWindow.__bootstrapAccountCasKeys = updates.map((item) => item.key);
        testWindow.__bootstrapRetryWaiting = true;
        await new Promise<void>((resolve) => { testWindow.__bootstrapReleaseRetry = resolve; });
        testWindow.__bootstrapRetryWaiting = false;
      }
      if (!testWindow.__bootstrapAbortArmed || !accountUpdate) return original.call(this, updates);
      testWindow.__bootstrapAbortArmed = false;
      testWindow.__bootstrapAbortTriggered = true;
      testWindow.__bootstrapAccountAtCas = accountUpdate.expected;
      const databasePrototype = IDBDatabase.prototype as unknown as { transaction: (...args: unknown[]) => IDBTransaction };
      const originalTransaction = databasePrototype.transaction;
      let didAbort = false;
      Object.defineProperty(databasePrototype, 'transaction', {
        configurable: true,
        value: function (this: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
          const transaction = originalTransaction.call(this, stores, mode, options);
          if (!didAbort && mode === 'readwrite' && stores === 'secure_records') {
            didAbort = true;
            transaction.addEventListener('abort', () => { testWindow.__bootstrapTransactionAborted = true; }, { once: true });
            queueMicrotask(() => transaction.abort());
            Object.defineProperty(databasePrototype, 'transaction', { configurable: true, value: originalTransaction });
          }
          return transaction;
        },
      });
      try { return await original.call(this, updates); }
      finally {
        Object.defineProperty(databasePrototype, 'transaction', { configurable: true, value: originalTransaction });
      }
    };
  }, `/@fs${resolve('service/src/storage/persistence.ts')}`);

  const bobPage = await resume(bob.context, invitation, bob.outbound, 'Bob');
  await expect.poll(() => alice.page.evaluate(() => (window as Window & { __bootstrapAbortTriggered?: boolean }).__bootstrapAbortTriggered)).toBe(true);
  await expect.poll(() => alice.page.evaluate(() => (window as Window & { __bootstrapRetryWaiting?: boolean }).__bootstrapRetryWaiting)).toBe(true);
  const bobBootstrapState = await bobPage.evaluate(async () => {
    const hook = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ROOM_LIFECYCLE__?: () => Promise<{ bootstrapState?: string; descriptors?: Array<{ bootstrapState?: string }> }> }).__K3NCRYPT_TEST_ROOM_LIFECYCLE__;
    const state = await hook?.();
    return state?.bootstrapState ?? state?.descriptors?.[0]?.bootstrapState;
  });
  expect(bobBootstrapState).toBe('PENDING_REMOTE');
  const failedCasAccountDigest = await alice.page.evaluate(async () => {
    const testWindow = window as Window & { __bootstrapAccountAtCas?: unknown; __bootstrapTransactionAborted?: boolean; __bootstrapDirectAccountWrites?: number; __bootstrapAccountCasAfterAbort?: number; __bootstrapAccountCasKeys?: string[] };
    const expected = testWindow.__bootstrapAccountAtCas;
    if (typeof expected !== 'string' || testWindow.__bootstrapTransactionAborted !== true) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected));
    return { hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), directAccountWrites: testWindow.__bootstrapDirectAccountWrites, accountCasAfterAbort: testWindow.__bootstrapAccountCasAfterAbort, accountCasKeys: testWindow.__bootstrapAccountCasKeys };
  });
  expect(failedCasAccountDigest?.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(failedCasAccountDigest?.directAccountWrites).toBe(0);
  expect(failedCasAccountDigest?.accountCasAfterAbort).toBe(1);
  expect(failedCasAccountDigest?.accountCasKeys?.some(key => key.startsWith('vodozemac-session:'))).toBe(true);
  expect(failedCasAccountDigest?.accountCasKeys?.some(key => key.startsWith('conversation-protocol:'))).toBe(true);
  expect(failedCasAccountDigest?.accountCasKeys?.some(key => key.startsWith('modern-seen:'))).toBe(true);
  const accountRecordUnchanged = await alice.page.evaluate(async () => {
    const testWindow = window as Window & { __bootstrapTransactionAborted?: boolean };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('k3ncrypt-local-vault', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('secure_records', 'readonly');
      const request = transaction.objectStore('secure_records').get('vodozemac-account:local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (typeof value !== 'string' || testWindow.__bootstrapTransactionAborted !== true) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  });
  console.log('FIRST_PREKEY_ABORT_SAFE_STATE', JSON.stringify({ accountUnchanged: accountRecordUnchanged === failedCasAccountDigest?.hash, directAccountWrites: failedCasAccountDigest?.directAccountWrites, recipientAcceptanceRetryObserved: failedCasAccountDigest?.accountCasAfterAbort === 1, transactionAborted: true, senderBootstrapState: bobBootstrapState }));
  expect(accountRecordUnchanged).toBe(failedCasAccountDigest?.hash);

  await alice.page.evaluate(() => (window as Window & { __bootstrapReleaseRetry?: () => void }).__bootstrapReleaseRetry?.());
  await alice.page.close({ runBeforeUnload: true });
  const aliceReturned = await resume(alice.context, invitation, alice.outbound, 'Alice');
  await expect(aliceReturned.locator('.chat-header')).toContainText(/Bob|Contact · [A-F0-9]{4}/, { timeout: 30_000 });
  await aliceReturned.locator('#msg-input').fill('Accepted only after the failed transaction was retried');
  await aliceReturned.locator('#send-btn').click();
  await expect(bobPage.locator('#messages-area')).toContainText('Accepted only after the failed transaction was retried', { timeout: 30_000 });
  await bob.context.close();
  await alice.context.close();
});

test('Alice can stay in Carol while Bob accepts, then accept Bob from durable mailbox replay', async ({ browser }) => {
  test.setTimeout(240_000);
  const alice = await open(browser);
  const roomLifecycle = async (stage: string, pages: Array<{ alias: string; page: Page }>) => {
    const snapshots = await Promise.all(pages.map(async ({ alias, page }) => ({
      alias,
      lifecycle: await page.evaluate(async () => {
        const hook = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ROOM_LIFECYCLE__?: () => Promise<unknown> }).__K3NCRYPT_TEST_ROOM_LIFECYCLE__;
        return hook ? await hook() : undefined;
      }),
    })));
    console.log('BOOTSTRAP_ROOM_LIFECYCLE', JSON.stringify({ stage, snapshots }));
  };
  const selectedRoomBinding = (page: Page) => page.evaluate(async () => {
    const hook = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ROOM_LIFECYCLE__?: () => Promise<{ selectedRoom?: string; selectedConversationRoom?: string; selectedTransportRoom?: string }> }).__K3NCRYPT_TEST_ROOM_LIFECYCLE__;
    const current = await hook?.();
    return current ? [current.selectedRoom, current.selectedConversationRoom, current.selectedTransportRoom] : [];
  });
  await alice.page.getByRole('button', { name: 'Create your private account' }).click();
  await alice.page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice');
  await alice.page.locator('#local-passphrase').fill(PASSPHRASE);
  await alice.page.locator('#local-passphrase-confirm').fill(PASSPHRASE);
  const aliceInviteCreated = alice.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/chat-link');
  await alice.page.getByRole('button', { name: 'Create secure account' }).click();
  expect((await aliceInviteCreated).status()).toBe(200);
  const carolInvitation = await alice.page.getByRole('textbox', { name: 'Private invitation' }).inputValue();
  const carolInvite = parseModernInviteInput(carolInvitation);
  console.log('BOOTSTRAP_INVITATION', JSON.stringify({ owner: 'Alice', peer: 'Carol', roomId: carolInvite?.roomId, invitationId: carolInvite?.version === 2 ? carolInvite.invitation.invitationId : undefined }));
  await alice.page.getByRole('button', { name: 'Continue to your chats' }).click();
  await roomLifecycle('alice-created-carol-invitation', [{ alias: 'Alice', page: alice.page }]);

  const carol = await open(browser);
  await carol.page.close();
  const carolPage = await resume(carol.context, carolInvitation, carol.outbound, 'Carol');
  await expect(carolPage.locator('#chat-container')).toBeVisible();
  await roomLifecycle('carol-accepted-signed-invitation', [{ alias: 'Alice', page: alice.page }, { alias: 'Carol', page: carolPage }]);
  await expect(alice.page.locator('.conversation-row')).toHaveCount(1);
  await alice.page.locator('.conversation-row').filter({ hasText: 'Carol' }).click();
  await expect(alice.page.locator('.chat-header')).toBeVisible();
  await expect(alice.page.locator('.chat-header')).toContainText(/Carol|Contact · [A-F0-9]{4}/);

  const bobInvitation = await invite(alice.page);
  const bobInvite = parseModernInviteInput(bobInvitation);
  console.log('BOOTSTRAP_INVITATION', JSON.stringify({ owner: 'Alice', peer: 'Bob', roomId: bobInvite?.roomId, invitationId: bobInvite?.version === 2 ? bobInvite.invitation.invitationId : undefined }));
  await roomLifecycle('alice-created-bob-invitation', [{ alias: 'Alice', page: alice.page }]);
  const pendingBob = alice.page.locator('.conversation-row').filter({ hasNotText: 'Carol' });
  const stayInBobDuringAcceptance = process.env.PLAYWRIGHT_BOOTSTRAP_STAY_IN_BOB_DURING_ACCEPTANCE === 'true';
  if (stayInBobDuringAcceptance) {
    await expect(pendingBob).toHaveCount(1);
    await pendingBob.click();
    await expect.poll(() => selectedRoomBinding(alice.page)).toEqual([bobInvite?.roomId, bobInvite?.roomId, bobInvite?.roomId]);
  }
  const carolRow = alice.page.locator('.conversation-row').filter({ hasText: 'Carol' });
  if (!stayInBobDuringAcceptance) {
    await carolRow.click();
    await expect.poll(() => selectedRoomBinding(alice.page)).toEqual([carolInvite?.roomId, carolInvite?.roomId, carolInvite?.roomId]);
    await expect(alice.page.locator('.chat-header')).toContainText(/Carol|Contact · [A-F0-9]{4}/);
  }
  await roomLifecycle(stayInBobDuringAcceptance ? 'alice-selected-bob-before-acceptance' : 'alice-switched-to-carol-before-acceptance', [{ alias: 'Alice', page: alice.page }]);

  const bob = await open(browser);
  await bob.page.close();
  const bobPage = await resume(bob.context, bobInvitation, bob.outbound, 'Bob');
  await expect(bobPage.locator('#chat-container')).toBeVisible();
  await roomLifecycle('bob-accepted-signed-invitation', [{ alias: 'Alice', page: alice.page }, { alias: 'Bob', page: bobPage }]);
  const roomAliceShouldViewDuringAcceptance = stayInBobDuringAcceptance ? bobInvite?.roomId : carolInvite?.roomId;
  await expect.poll(() => selectedRoomBinding(alice.page)).toEqual([roomAliceShouldViewDuringAcceptance, roomAliceShouldViewDuringAcceptance, roomAliceShouldViewDuringAcceptance]);
  if (!stayInBobDuringAcceptance) await expect(alice.page.locator('.chat-header')).toContainText(/Carol|Contact · [A-F0-9]{4}/);
  if (!stayInBobDuringAcceptance) {
    await expect(pendingBob).toHaveCount(1);
    await pendingBob.click();
    await expect.poll(() => selectedRoomBinding(alice.page)).toEqual([bobInvite?.roomId, bobInvite?.roomId, bobInvite?.roomId]);
  }
  await roomLifecycle('alice-opened-bob-after-acceptance', [{ alias: 'Alice', page: alice.page }, { alias: 'Bob', page: bobPage }, { alias: 'Carol', page: carolPage }]);
  if (!stayInBobDuringAcceptance) await expect(alice.page.locator('.chat-header')).toContainText(/Bob|Contact · [A-F0-9]{4}/);

  const firstMessage = 'Alice accepted Bob after switching rooms';
  const traceStartIndex = await alice.page.evaluate(() => {
    const state = globalThis as typeof globalThis & { __k3ncryptMessageFlowEvents?: Array<{ eventId: string; roomId: string; stage: string }> };
    return state.__k3ncryptMessageFlowEvents?.length ?? 0;
  });
  await alice.page.locator('#msg-input').fill(firstMessage);
  await expect(alice.page.locator('#send-btn')).toBeEnabled();
  await alice.page.locator('#send-btn').click();
  await expect(alice.page.locator('#messages-area')).toContainText(firstMessage);
  const actualSend = await alice.page.evaluate((startIndex) => {
    const state = globalThis as typeof globalThis & { __k3ncryptMessageFlowEvents?: Array<{ eventId: string; roomId: string; stage: string }> };
    return (state.__k3ncryptMessageFlowEvents ?? []).slice(startIndex).find(event => event.stage === 'context-send-room');
  }, traceStartIndex);
  expect(actualSend).toBeDefined();
  expect(actualSend?.roomId).toBe(bobInvite?.roomId);
  await bobPage.waitForTimeout(1_000);
  const cryptoDiagnostics = async (page: Page) => page.evaluate(async () => {
    const hook = (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_CRYPTO_DIAGNOSTICS__?: () => Promise<unknown> }).__K3NCRYPT_ACTIVE_CRYPTO_DIAGNOSTICS__;
    return hook ? await hook() : undefined;
  });
  const safeSummary = await Promise.all([alice.page, bobPage].map(async page => ({
    localProfile: await page.locator('.sidebar-profile strong').textContent(),
    draftRetained: Boolean(await page.locator('#msg-input').inputValue()),
    safeSendFailureDisplayed: (await page.getByRole('status').filter({ hasText: 'Could not confirm sending' }).count()) > 0,
    sentTextProjected: (await page.locator('#messages-area').getByText(firstMessage).count()) > 0,
    inbound: await cryptoDiagnostics(page),
    renderedMessageCount: await page.locator('#messages-area .message').count(),
  })));
  console.log('BOOTSTRAP_SAFE_DIAGNOSTICS', JSON.stringify(safeSummary));
  const messageFlow = await Promise.all([{ alias: 'Alice', page: alice.page }, { alias: 'Bob', page: bobPage }, { alias: 'Carol', page: carolPage }].map(async ({ alias, page }) => ({ alias, events: await page.evaluate((eventId) => {
    const state = globalThis as typeof globalThis & { __k3ncryptMessageFlowEvents?: Array<{ eventId: string; roomId: string; stage: string; relayId?: string; state?: string; failureCategory?: string }> };
    return (state.__k3ncryptMessageFlowEvents ?? []).filter(event => event.eventId === eventId);
  }, actualSend!.eventId) })));
  console.log('BOOTSTRAP_MESSAGE_FLOW', JSON.stringify({ eventId: actualSend!.eventId, traces: messageFlow }));
  await roomLifecycle('post-send-and-recipient-ack', [{ alias: 'Alice', page: alice.page }, { alias: 'Bob', page: bobPage }, { alias: 'Carol', page: carolPage }]);
  await expect(bobPage.locator('#messages-area')).toContainText(firstMessage, { timeout: 30_000 });
  await bobPage.locator('#msg-input').fill('Bob received the mailbox introduction');
  await bobPage.locator('#send-btn').click();
  await expect(alice.page.locator('#messages-area')).toContainText('Bob received the mailbox introduction', { timeout: 30_000 });

  await alice.page.close({ runBeforeUnload: true });
  const aliceAgain = await resume(alice.context, BASE_URL, alice.outbound);
  const rows = aliceAgain.locator('.conversation-row');
  await expect(rows).toHaveCount(2);
  let bobReopened = false;
  for (let index = 0; index < 2; index += 1) {
    await rows.nth(index).click();
    if (await aliceAgain.locator('#messages-area').getByText('Alice accepted Bob after switching rooms').count()) {
      bobReopened = true;
      break;
    }
  }
  expect(bobReopened).toBe(true);
  await expect(aliceAgain.locator('#messages-area')).toContainText('Bob received the mailbox introduction');
  await carol.context.close();
  await bob.context.close();
  await alice.context.close();
});
