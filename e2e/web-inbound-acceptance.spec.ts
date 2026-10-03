import { test, expect, type Browser, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const root = `/@fs${resolve('.')}`;
const passphrase = 'disposable inbound acceptance test vault';
const conversationId = 'delivery-foundation-e2e-conversation';
const messageBytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer;

const initializeReceiver = async (page: Page): Promise<unknown> => {
    await page.goto('/');
    return page.evaluate(async ({ root, passphrase }) => {
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.initializeWithPassphrase(passphrase);
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        const bundle = await runtime.getPublicBundle();
        (window as any).__inboundAcceptance = { storage, runtime };
        return bundle;
    }, { root, passphrase });
};

const initializeSender = async (browser: Browser, bundle: any): Promise<{ page: Page; identity: string; envelope: any }> => {
    // localhost and 127.0.0.1 have separate IndexedDB origins, so the two test
    // identities use independent real BrowserSecureStorage databases.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:43213/');
    const sender = await page.evaluate(async ({ root, passphrase, conversationId, recipient }) => {
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.initializeWithPassphrase(passphrase);
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        const identity = (await runtime.getPublicBundle()).identity.curve25519;
        await runtime.establishOutboundSession(conversationId, recipient.identity.curve25519, recipient.oneTimeKeys[0].key);
        const emptyOutbox = new TextEncoder().encode('[]').buffer as ArrayBuffer;
        await storage.write('modern-outbox', conversationId, emptyOutbox);
        let envelope: unknown;
        const plaintext = new TextEncoder().encode(JSON.stringify({ body: 'first' }));
        await runtime.encryptMessageWithAtomicRecords(plaintext.buffer.slice(0) as ArrayBuffer, (encrypted: unknown) => {
            envelope = encrypted;
            return [{ recordType: 'modern-outbox', recordId: conversationId, expected: emptyOutbox,
                next: new TextEncoder().encode(JSON.stringify([{ envelope: encrypted, clientId: 'first' }])).buffer as ArrayBuffer }];
        });
        plaintext.fill(0);
        (window as any).__inboundSender = { storage, runtime };
        return { identity, envelope };
    }, { root, passphrase, conversationId, recipient: bundle });
    return { page, identity: sender.identity, envelope: sender.envelope };
};

const sendNext = async (page: Page, body: string): Promise<unknown> => page.evaluate(async ({ body, conversationId }) => {
    const { storage, runtime } = (window as any).__inboundSender;
    const expected = await storage.read('modern-outbox', conversationId);
    const pending = JSON.parse(new TextDecoder().decode(expected));
    const plaintext = new TextEncoder().encode(JSON.stringify({ body }));
    let envelope: unknown;
    await runtime.encryptMessageWithAtomicRecords(plaintext.buffer.slice(0) as ArrayBuffer, (encrypted: unknown) => {
        envelope = encrypted;
        pending.push({ envelope: encrypted, clientId: body });
        return [{ recordType: 'modern-outbox', recordId: conversationId, expected,
            next: new TextEncoder().encode(JSON.stringify(pending)).buffer as ArrayBuffer }];
    });
    plaintext.fill(0);
    return envelope;
}, { body, conversationId });

const acceptInbound = async (page: Page, senderIdentity: string, envelope: any, first: boolean, abort: boolean): Promise<any> =>
    page.evaluate(async ({ root, conversationId, senderIdentity, envelope, first, abort }) => {
        const { storage, runtime } = (window as any).__inboundAcceptance;
        const { envelopeIdForEnvelope } = await import(/* @vite-ignore */ `${root}/service/src/delivery/envelopeIdentity.ts`);
        const stableId = await envelopeIdForEnvelope(conversationId, envelope);
        const legacyDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(envelope)))),
            (value) => value.toString(16).padStart(2, '0')).join('');
        const beforeAccount = await storage.read('vodozemac-account', 'local');
        const buildUpdates = async (plaintext: ArrayBuffer) => {
            const rawMessages = await storage.read('product-messages', conversationId);
            const rawSeen = await storage.read('modern-seen', conversationId);
            const rawStableSeen = await storage.read('modern-seen-v1', conversationId);
            const messages = rawMessages ? JSON.parse(new TextDecoder().decode(rawMessages)) : [];
            const seen = rawSeen ? JSON.parse(new TextDecoder().decode(rawSeen)) : [];
            const stableSeen = rawStableSeen ? JSON.parse(new TextDecoder().decode(rawStableSeen)).ids : [];
            const payload = new Uint8Array(plaintext);
            const content = first ? payload.slice(2) : payload.slice();
            const body = JSON.parse(new TextDecoder().decode(content)).body;
            content.fill(0);
            messages.push({ id: stableId, envelopeId: stableId, body });
            seen.push(legacyDigest);
            stableSeen.push(stableId);
            return [
                { recordType: 'product-messages', recordId: conversationId, expected: rawMessages,
                    next: new TextEncoder().encode(JSON.stringify(messages)).buffer as ArrayBuffer },
                { recordType: 'modern-seen', recordId: conversationId, expected: rawSeen,
                    next: new TextEncoder().encode(JSON.stringify(seen)).buffer as ArrayBuffer },
                { recordType: 'modern-seen-v1', recordId: conversationId, expected: rawStableSeen,
                    next: new TextEncoder().encode(JSON.stringify({ version: 1, ids: stableSeen })).buffer as ArrayBuffer },
            ];
        };
        const originalPut = IDBObjectStore.prototype.put;
        if (abort) {
            IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
                if (String(key).startsWith(`product-messages:${conversationId}`)) {
                    this.transaction.abort();
                    throw new DOMException('injected acceptance transaction abort', 'AbortError');
                }
                return originalPut.call(this, value, key);
            };
        }
        let rejected = false;
        try {
            if (first) await runtime.establishInboundSessionAndCommit(conversationId, senderIdentity, envelope.data.olmMessage, buildUpdates);
            else await runtime.decryptAndCommitInbound('message', envelope, buildUpdates);
        } catch { rejected = true; }
        finally { IDBObjectStore.prototype.put = originalPut; }
        const [accountAfter, session, messages, seen, stableSeen] = await Promise.all([
            storage.read('vodozemac-account', 'local'), storage.read('vodozemac-session', conversationId),
            storage.read('product-messages', conversationId), storage.read('modern-seen', conversationId), storage.read('modern-seen-v1', conversationId),
        ]);
        return {
            rejected, stableId, sessionId: runtime.activeSessionId,
            accountUnchanged: !!beforeAccount && !!accountAfter && new Uint8Array(beforeAccount).every((byte, index) => byte === new Uint8Array(accountAfter)[index]),
            sessionPresent: !!session, messages: messages ? JSON.parse(new TextDecoder().decode(messages)) : [],
            seen: seen ? JSON.parse(new TextDecoder().decode(seen)) : [],
            stableSeen: stableSeen ? JSON.parse(new TextDecoder().decode(stableSeen)).ids : [],
        };
    }, { root, conversationId, senderIdentity, envelope, first, abort });

const reloadReceiver = async (page: Page, sessionId: string): Promise<void> => {
    await page.reload();
    await page.evaluate(async ({ root, passphrase, conversationId, sessionId }) => {
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.unlock(passphrase);
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await runtime.restoreSession(conversationId, sessionId);
        (window as any).__inboundAcceptance = { storage, runtime };
    }, { root, passphrase, conversationId, sessionId });
};

test('real Vodozemac + IndexedDB acceptance abort is all-or-nothing and exact redelivery recovers', async ({ page, browser }) => {
    const receiverBundle = await initializeReceiver(page) as any;
    const sender = await initializeSender(browser, receiverBundle);
    try {
        const failedFirst = await acceptInbound(page, sender.identity, sender.envelope, true, true);
        expect(failedFirst.rejected).toBe(true);
        expect(failedFirst.accountUnchanged).toBe(true);
        expect(failedFirst.sessionPresent).toBe(false);
        expect(failedFirst.messages).toEqual([]);
        expect(failedFirst.seen).toEqual([]);
        expect(failedFirst.stableSeen).toEqual([]);

        // Reload discards the consumed in-memory pre-key account; redelivery
        // must use the exact same ciphertext and commit all acceptance records.
        await page.reload();
        await page.evaluate(async ({ root, passphrase }) => {
            const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
            const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
            const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
            const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
            const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
            await storage.unlock(passphrase);
            const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
            await runtime.initialize(); await runtime.restoreOrCreateIdentity();
            (window as any).__inboundAcceptance = { storage, runtime };
        }, { root, passphrase });
        const recovered = await acceptInbound(page, sender.identity, sender.envelope, true, false);
        expect(recovered.rejected).toBe(false);
        expect(recovered.sessionPresent).toBe(true);
        expect(recovered.messages).toHaveLength(1);
        expect(recovered.messages[0].envelopeId).toBe(recovered.stableId);
        expect(recovered.seen).toHaveLength(1);
        expect(recovered.stableSeen).toEqual([recovered.stableId]);

        const secondEnvelope = await sendNext(sender.page, 'second');
        await reloadReceiver(page, recovered.sessionId);
        const abortedEstablished = await acceptInbound(page, sender.identity, secondEnvelope, false, true);
        expect(abortedEstablished.rejected).toBe(true);
        expect(abortedEstablished.messages).toHaveLength(1);
        expect(abortedEstablished.seen).toHaveLength(1);
        expect(abortedEstablished.stableSeen).toHaveLength(1);
        expect(abortedEstablished.sessionPresent).toBe(true);

        const retriedEstablished = await acceptInbound(page, sender.identity, secondEnvelope, false, false);
        expect(retriedEstablished.rejected).toBe(false);
        expect(retriedEstablished.messages).toHaveLength(2);
        expect(retriedEstablished.messages[1].envelopeId).toBe(retriedEstablished.stableId);
        expect(retriedEstablished.stableSeen).toHaveLength(2);
        const sessionId = retriedEstablished.sessionId;
        await reloadReceiver(page, sessionId);
        const persisted = await page.evaluate(async ({ conversationId }) => {
            const { storage, runtime } = (window as any).__inboundAcceptance;
            return {
                activeSession: runtime.activeSessionId,
                messages: JSON.parse(new TextDecoder().decode(await storage.read('product-messages', conversationId))),
                seen: JSON.parse(new TextDecoder().decode(await storage.read('modern-seen', conversationId))),
                stableSeen: JSON.parse(new TextDecoder().decode(await storage.read('modern-seen-v1', conversationId))).ids,
            };
        }, { conversationId });
        expect(persisted.activeSession).toBe(sessionId);
        expect(persisted.messages).toHaveLength(2);
        expect(persisted.seen).toHaveLength(2);
        expect(persisted.stableSeen).toHaveLength(2);
    } finally {
        await sender.page.context().close();
    }
});
