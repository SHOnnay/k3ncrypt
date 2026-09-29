import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const passphrase = 'phase one f atomic acceptance';
const urls = {
  runtime: `/@fs${resolve(process.cwd(), 'service/src/crypto/vodozemacRuntime.ts')}`,
  vault: `/@fs${resolve(process.cwd(), 'service/src/storage/secureVault.ts')}`,
  persistence: `/@fs${resolve(process.cwd(), 'service/src/storage/persistence.ts')}`,
};

type AcceptanceFixture = {
  envelope: { version: number; strategy: string; data: { version: number; olmMessage: string } };
  digest: string;
  atomicWriteFailed: boolean;
  accountUnchangedAfterFailure: boolean;
  sessionUnchangedAfterFailure: boolean;
  noMessageAfterFailure: boolean;
  noSeenMarkerAfterFailure: boolean;
};

const prepareAndFailAcceptance = async (page: Page): Promise<AcceptanceFixture> => page.evaluate(async ({ moduleUrls, roomId, secret }) => {
  const [{ loadVodozemacBindings }, { VodozemacRuntime }, { BrowserSecureStorage }, { IndexedDbVaultPersistence }] = await Promise.all([
    import('/src/crypto/vodozemacModule.ts'), import(/* @vite-ignore */ moduleUrls.runtime),
    import(/* @vite-ignore */ moduleUrls.vault), import(/* @vite-ignore */ moduleUrls.persistence),
  ]);
  class FailOncePersistence extends IndexedDbVaultPersistence {
    failNext = false;
    injected = false;
    async compareAndSwapRecords(updates: readonly { key: string; expected: string | undefined; next: string }[]): Promise<boolean> {
      if (this.failNext) {
        this.failNext = false;
        this.injected = true;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('k3ncrypt-local-vault', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return new Promise<boolean>((resolve, reject) => {
          const transaction = database.transaction('secure_records', 'readwrite');
          const store = transaction.objectStore('secure_records');
          let remaining = updates.length;
          let mismatch = false;
          transaction.oncomplete = () => resolve(true);
          transaction.onabort = () => mismatch ? resolve(false) : reject(transaction.error ?? new Error('Injected acceptance transaction abort.'));
          for (const item of updates) {
            const request = store.get(item.key);
            request.onsuccess = () => {
              if (mismatch) return;
              if (request.result !== item.expected) { mismatch = true; transaction.abort(); return; }
              if (--remaining === 0) {
                // Abort after the first put while the real IndexedDB transaction is still open.
                store.put(updates[0].next, updates[0].key);
                transaction.abort();
              }
            };
          }
        });
      }
      return super.compareAndSwapRecords(updates);
    }
  }
  const persistence = new FailOncePersistence();
  const vault = new BrowserSecureStorage(persistence);
  await vault.initializeWithPassphrase(secret);
  const receiver = new VodozemacRuntime(vault, loadVodozemacBindings);
  await receiver.initialize();
  await receiver.restoreOrCreateIdentity();
  const receiverBundle = await receiver.getPublicBundle();
  const bindings = await loadVodozemacBindings();
  const sender = bindings.accountFactory.createAccount();
  sender.generateFallbackKey();
  const senderCurve = JSON.parse(sender.identityKeys()).curve25519 as string;
  const senderSession = sender.createOutboundSession!(receiverBundle.identity.curve25519, receiverBundle.fallbackKey!.key);
  const frame = (text: string) => Uint8Array.from([1, 1, ...new TextEncoder().encode(text)]);
  const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: senderSession.encrypt(frame('crash-window message')) } };
  const sessionBefore = await vault.read('vodozemac-session', roomId);
  const accountBefore = await vault.read('vodozemac-account', 'local');
  const bytesEqual = (a: ArrayBuffer, b: ArrayBuffer) => new Uint8Array(a).length === new Uint8Array(b).length && new Uint8Array(a).every((byte, index) => byte === new Uint8Array(b)[index]);
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(envelope))));
  const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await vault.write('test-sender-session', roomId, senderSession.saveSession().slice().buffer as ArrayBuffer);
  const persistedMessage = new TextEncoder().encode(JSON.stringify([{ id: digest, text: 'crash-window message' }])).buffer as ArrayBuffer;
  const inbox = new TextEncoder().encode(JSON.stringify({ version: 1, text: 'crash-window message' })).buffer as ArrayBuffer;
  const seen = new TextEncoder().encode(JSON.stringify([digest])).buffer as ArrayBuffer;
  await vault.write('test-sender-curve', roomId, new TextEncoder().encode(senderCurve).buffer as ArrayBuffer);
  await vault.write('test-session-id', roomId, new TextEncoder().encode(senderSession.sessionId()).buffer as ArrayBuffer);
  persistence.failNext = true;
  let atomicWriteFailed = false;
  try {
    await receiver.establishInboundSessionAndCommit(roomId, senderCurve, envelope.data.olmMessage, async (plaintext) => {
      const decoded = new TextDecoder().decode(new Uint8Array(plaintext).slice(2));
      if (decoded !== 'crash-window message') throw new Error('Unexpected decrypted text');
      return [
        { recordType: 'product-messages', recordId: roomId, expected: undefined, next: persistedMessage },
        { recordType: 'modern-accepted-message', recordId: `${roomId}:${digest}`, expected: undefined, next: inbox },
        { recordType: 'modern-seen', recordId: roomId, expected: undefined, next: seen },
      ];
    });
  } catch {
    atomicWriteFailed = persistence.injected;
  }
  const sessionAfter = await vault.read('vodozemac-session', roomId);
  const accountAfter = await vault.read('vodozemac-account', 'local');
  const equalOptional = (a?: ArrayBuffer, b?: ArrayBuffer) => a === undefined || b === undefined ? a === b : bytesEqual(a, b);
  const result = {
    envelope, digest, atomicWriteFailed,
    accountUnchangedAfterFailure: equalOptional(accountBefore, accountAfter),
    sessionUnchangedAfterFailure: equalOptional(sessionBefore, sessionAfter),
    noMessageAfterFailure: !(await vault.read('product-messages', roomId)),
    noSeenMarkerAfterFailure: !(await vault.read('modern-seen', roomId)),
  };
  senderSession.free?.(); sender.free?.(); receiver.close(); vault.lock();
  return result;
}, { moduleUrls: urls, roomId: room, secret: passphrase });

const replayAfterReloadAndCheckSession = async (page: Page, fixture: AcceptanceFixture) => page.evaluate(async ({ moduleUrls, roomId, secret, saved }) => {
  const [{ loadVodozemacBindings }, { VodozemacRuntime }, { BrowserSecureStorage }, { IndexedDbVaultPersistence }] = await Promise.all([
    import('/src/crypto/vodozemacModule.ts'), import(/* @vite-ignore */ moduleUrls.runtime),
    import(/* @vite-ignore */ moduleUrls.vault), import(/* @vite-ignore */ moduleUrls.persistence),
  ]);
  const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence());
  await vault.unlock(secret);
  const receiver = new VodozemacRuntime(vault, loadVodozemacBindings);
  await receiver.initialize();
  await receiver.restoreOrCreateIdentity();
  const senderCurve = new TextDecoder().decode((await vault.read('test-sender-curve', roomId))!);
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(saved.envelope))));
  const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== saved.digest) throw new Error('Envelope digest changed across restart.');
  const sessionBefore = await vault.read('vodozemac-session', roomId);
  let acceptedMessage = '';
  await receiver.establishInboundSessionAndCommit(roomId, senderCurve, saved.envelope.data.olmMessage, async (plaintext) => {
    acceptedMessage = new TextDecoder().decode(new Uint8Array(plaintext).slice(2));
    const records = await Promise.all([
      vault.read('product-messages', roomId), vault.read('modern-accepted-message', `${roomId}:${digest}`), vault.read('modern-seen', roomId),
    ]);
    return [
      { recordType: 'product-messages', recordId: roomId, expected: records[0], next: new TextEncoder().encode(JSON.stringify([{ id: digest, text: acceptedMessage }])).buffer as ArrayBuffer },
      { recordType: 'modern-accepted-message', recordId: `${roomId}:${digest}`, expected: records[1], next: new TextEncoder().encode(JSON.stringify({ version: 1, text: acceptedMessage })).buffer as ArrayBuffer },
      { recordType: 'modern-seen', recordId: roomId, expected: records[2], next: new TextEncoder().encode(JSON.stringify([digest])).buffer as ArrayBuffer },
    ];
  });
  const restoredSessionId = receiver.activeSessionId;
  const expectedSessionId = new TextDecoder().decode((await vault.read('test-session-id', roomId))!);
  const durable = await Promise.all([
    vault.read('product-messages', roomId), vault.read('modern-accepted-message', `${roomId}:${digest}`), vault.read('modern-seen', roomId),
  ]);
  const messageList = JSON.parse(new TextDecoder().decode(durable[0]!)) as { id: string; text: string }[];
  const seenList = JSON.parse(new TextDecoder().decode(durable[2]!)) as string[];
  const inboxMessage = JSON.parse(new TextDecoder().decode(durable[1]!)) as { version: number; text: string };
  // Production ModernConversation checks this persisted marker before decrypting a redelivery.
  const duplicateAcceptedWithoutDecrypt = seenList.includes(digest);
  const afterDuplicate = JSON.parse(new TextDecoder().decode((await vault.read('product-messages', roomId))!)) as { id: string; text: string }[];
  const sessionAfterAcceptance = await vault.read('vodozemac-session', roomId);
  const senderBytes = new Uint8Array((await vault.read('test-sender-session', roomId))!);
  const bindings = await loadVodozemacBindings();
  const senderSession = bindings.sessionFactory.loadSession(senderBytes);
  senderBytes.fill(0);
  const frame = (text: string) => Uint8Array.from([1, 1, ...new TextEncoder().encode(text)]);
  const followUp = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: senderSession.encrypt(frame('follow-up after restart')) } };
  let followUpText = '';
  await receiver.decryptAndCommitInbound('message', followUp, async (plaintext) => {
    followUpText = new TextDecoder().decode(new Uint8Array(plaintext));
    const current = await vault.read('product-messages', roomId);
    const currentSeen = await vault.read('modern-seen', roomId);
    const currentMessages = JSON.parse(new TextDecoder().decode(current!)) as { id: string; text: string }[];
    const currentDigests = JSON.parse(new TextDecoder().decode(currentSeen!)) as string[];
    const followDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(followUp)))), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return [
      { recordType: 'product-messages', recordId: roomId, expected: current, next: new TextEncoder().encode(JSON.stringify([...currentMessages, { id: followDigest, text: followUpText }])).buffer as ArrayBuffer },
      { recordType: 'modern-seen', recordId: roomId, expected: currentSeen, next: new TextEncoder().encode(JSON.stringify([...currentDigests, followDigest])).buffer as ArrayBuffer },
      { recordType: 'modern-accepted-message', recordId: `${roomId}:${followDigest}`, expected: undefined, next: new TextEncoder().encode(JSON.stringify({ version: 1, text: followUpText })).buffer as ArrayBuffer },
    ];
  });
  const finalMessages = JSON.parse(new TextDecoder().decode((await vault.read('product-messages', roomId))!)) as { id: string; text: string }[];
  senderSession.free?.(); receiver.close(); vault.lock();
  return {
    acceptedMessage, messageList, inboxMessage, seenList, duplicateAcceptedWithoutDecrypt,
    duplicateCount: afterDuplicate.filter((message) => message.id === digest).length,
    sessionAdvancedAtomically: !sessionBefore && !!sessionAfterAcceptance,
    restoredSessionMatches: restoredSessionId === expectedSessionId,
    followUpText, finalMessageCount: finalMessages.length,
  };
}, { moduleUrls: urls, roomId: room, secret: passphrase, saved: fixture });

test.describe('Phase 1F Web atomic inbound acceptance with real WASM and encrypted IndexedDB', () => {
  test('failed acceptance transaction leaves ratchet unchanged; reload and redelivery accept once and session remains usable', async ({ page }) => {
    await page.goto('/crypto-smoke.html');
    const fixture = await prepareAndFailAcceptance(page);
    expect(fixture).toMatchObject({
      atomicWriteFailed: true,
      accountUnchangedAfterFailure: true,
      sessionUnchangedAfterFailure: true,
      noMessageAfterFailure: true,
      noSeenMarkerAfterFailure: true,
    });
    await page.reload();
    const recovered = await replayAfterReloadAndCheckSession(page, fixture);
    expect(recovered).toMatchObject({
      acceptedMessage: 'crash-window message',
      messageList: [{ id: fixture.digest, text: 'crash-window message' }],
      inboxMessage: { version: 1, text: 'crash-window message' },
      duplicateAcceptedWithoutDecrypt: true,
      duplicateCount: 1,
      sessionAdvancedAtomically: true,
      restoredSessionMatches: true,
      followUpText: 'follow-up after restart',
      finalMessageCount: 2,
    });
  });
});
