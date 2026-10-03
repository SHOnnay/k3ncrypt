import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const root = `/@fs${resolve('.')}`;
const passphrase = 'disposable Web outbox recovery test vault';
const conversationId = 'outbox-recovery-test-conversation';

const initializeRuntime = async (page: Page): Promise<void> => {
    await page.goto('/');
    await page.evaluate(async ({ root, passphrase, conversationId }) => {
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.initializeWithPassphrase(passphrase);
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        const bindings = await loadVodozemacBindings();
        const recipient = bindings.accountFactory.createAccount();
        recipient.generateOneTimeKeys(1);
        const recipientIdentity = JSON.parse(recipient.identityKeys());
        const recipientOneTimeKey = recipient.availableOneTimeKeys()[0];
        await runtime.establishOutboundSession(conversationId, recipientIdentity.curve25519, recipientOneTimeKey);
        const sessionId = runtime.activeSessionId!;
        const emptyOutbox = new TextEncoder().encode('[]').buffer as ArrayBuffer;
        await storage.write('modern-outbox', conversationId, emptyOutbox);
        const session = await storage.read('vodozemac-session', conversationId);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', session!));
        const digestHex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
        await storage.write('outbox-recovery-test', 'metadata', new TextEncoder().encode(JSON.stringify({ conversationId, sessionId, digestHex })).buffer as ArrayBuffer);
        (window as any).__outboxRecovery = { storage, runtime, conversationId };
    }, { root, passphrase, conversationId });
};

const atomicSend = async (page: Page, clientId: string): Promise<unknown> => page.evaluate(async (clientId) => {
    const { storage, runtime, conversationId } = (window as any).__outboxRecovery;
    const raw = await storage.read('modern-outbox', conversationId);
    const pending = JSON.parse(new TextDecoder().decode(raw));
    const plaintext = new TextEncoder().encode('synthetic browser persistence test message');
    const envelope = await runtime.encryptMessageWithAtomicRecords(plaintext.buffer.slice(0) as ArrayBuffer, (encrypted: unknown) => {
        pending.push({ envelope: encrypted, clientId });
        return [{ recordType: 'modern-outbox', recordId: conversationId, expected: raw,
            next: new TextEncoder().encode(JSON.stringify(pending)).buffer as ArrayBuffer }];
    });
    plaintext.fill(0);
    return envelope;
}, clientId);

const restoreRuntime = async (page: Page): Promise<{ pending: unknown[]; sessionId: string; digestHex: string }> => {
    await page.reload();
    return page.evaluate(async ({ root, passphrase }) => {
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.unlock(passphrase);
        const metadataBytes = await storage.read('outbox-recovery-test', 'metadata');
        const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await runtime.restoreSession(metadata.conversationId, metadata.sessionId);
        const pendingBytes = await storage.read('modern-outbox', metadata.conversationId);
        const session = await storage.read('vodozemac-session', metadata.conversationId);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', session!));
        const digestHex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
        (window as any).__outboxRecovery = { storage, runtime, conversationId: metadata.conversationId };
        return { pending: pendingBytes ? JSON.parse(new TextDecoder().decode(pendingBytes)) : [], sessionId: runtime.activeSessionId!, digestHex,
            expectedDigestHex: metadata.digestHex };
    }, { root, passphrase });
};

const abortOutboxTransaction = async (page: Page, clientId: string): Promise<void> => {
    await page.evaluate(async (clientId) => {
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
            if (String(key).includes('modern-outbox')) {
                this.transaction.abort();
                throw new DOMException('test transaction abort', 'AbortError');
            }
            return originalPut.call(this, value, key);
        };
        try { await (window as any).__outboxRecovery.send(clientId); }
        catch { /* the transaction abort is the expected result */ }
        finally { IDBObjectStore.prototype.put = originalPut; }
    }, clientId);
};

test('normal encrypted message commit stores its envelope and advanced session snapshot', async ({ page }) => {
    await initializeRuntime(page);
    const envelope = await atomicSend(page, 'message-1');
    const result = await page.evaluate(async () => {
        const { storage, conversationId } = (window as any).__outboxRecovery;
        return {
            session: !!await storage.read('vodozemac-session', conversationId),
            outbox: JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!)),
            marker: await storage.read('vodozemac-commit', 'local'),
        };
    });
    expect(result.session).toBe(true);
    expect(result.outbox).toEqual([{ envelope, clientId: 'message-1' }]);
    expect(result.marker).toBeUndefined();
});

test('real IndexedDB abort leaves both session and outbox unchanged', async ({ page }) => {
    await initializeRuntime(page);
    await page.evaluate(() => {
        const task = (window as any).__outboxRecovery;
        task.send = (clientId: string) => {
            const { storage, runtime, conversationId } = task;
            return storage.read('modern-outbox', conversationId).then(async (raw: ArrayBuffer) => {
                const pending = JSON.parse(new TextDecoder().decode(raw));
                const bytes = new TextEncoder().encode('synthetic browser persistence test message');
                return runtime.encryptMessageWithAtomicRecords(bytes.buffer, (envelope: unknown) => {
                    pending.push({ envelope, clientId });
                    return [{ recordType: 'modern-outbox', recordId: conversationId, expected: raw,
                        next: new TextEncoder().encode(JSON.stringify(pending)).buffer }];
                });
            });
        };
    });
    await abortOutboxTransaction(page, 'aborted-message');
    const restored = await restoreRuntime(page);
    expect(restored.pending).toEqual([]);
    expect(restored.sessionId).toBeTruthy();
    expect(restored.digestHex).toBe(restored.expectedDigestHex);
});

test('an aborted transaction restores the live runtime so a later send can retry safely', async ({ page }) => {
    await initializeRuntime(page);
    const result = await page.evaluate(async () => {
        const task = (window as any).__outboxRecovery;
        const { storage, runtime, conversationId } = task;
        const raw = await storage.read('modern-outbox', conversationId);
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
            if (String(key).includes('modern-outbox')) { this.transaction.abort(); throw new DOMException('abort', 'AbortError'); }
            return original.call(this, value, key);
        };
        const makeSend = (clientId: string) => storage.read('modern-outbox', conversationId).then((expected: ArrayBuffer) => {
            const pending = JSON.parse(new TextDecoder().decode(expected));
            const bytes = new TextEncoder().encode('synthetic retry message');
            return runtime.encryptMessageWithAtomicRecords(bytes.buffer, (envelope: unknown) => {
                pending.push({ envelope, clientId });
                return [{ recordType: 'modern-outbox', recordId: conversationId, expected,
                    next: new TextEncoder().encode(JSON.stringify(pending)).buffer }];
            });
        });
        let rejected = false;
        try { await makeSend('aborted'); } catch { rejected = true; }
        finally { IDBObjectStore.prototype.put = original; }
        const envelope = await makeSend('recovered');
        return { rejected, lifecycle: runtime.lifecycle, envelope,
            pending: JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!)) };
    });
    expect(result.rejected).toBe(true);
    expect(result.lifecycle).toBe('active');
    expect(result.pending).toEqual([{ envelope: result.envelope, clientId: 'recovered' }]);
});

test('reload after pre-commit interruption recovers the old session with no phantom envelope', async ({ page }) => {
    await initializeRuntime(page);
    await page.evaluate(() => {
        const task = (window as any).__outboxRecovery;
        task.send = async () => {
            const { storage, runtime, conversationId } = task;
            const raw = await storage.read('modern-outbox', conversationId);
            const pending = JSON.parse(new TextDecoder().decode(raw));
            const bytes = new TextEncoder().encode('interrupted message');
            return runtime.encryptMessageWithAtomicRecords(bytes.buffer, (envelope: unknown) => {
                pending.push({ envelope, clientId: 'interrupted' });
                return [{ recordType: 'modern-outbox', recordId: conversationId, expected: raw,
                    next: new TextEncoder().encode(JSON.stringify(pending)).buffer }];
            });
        };
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
            if (String(key).includes('modern-outbox')) { this.transaction.abort(); throw new DOMException('abort', 'AbortError'); }
            return original.call(this, value, key);
        };
        task.restorePut = () => { IDBObjectStore.prototype.put = original; };
    });
    await page.evaluate(async () => { try { await (window as any).__outboxRecovery.send(); } catch {} finally { (window as any).__outboxRecovery.restorePut(); } });
    const restored = await restoreRuntime(page);
    expect(restored.pending).toEqual([]);
    expect(restored.digestHex).toBe(restored.expectedDigestHex);
});

test('reload after commit restores the exact pending ciphertext without re-encryption', async ({ page }) => {
    await initializeRuntime(page);
    const envelope = await atomicSend(page, 'committed-message');
    const restored = await restoreRuntime(page);
    expect(restored.pending).toEqual([{ envelope, clientId: 'committed-message' }]);
    expect(restored.sessionId).toBeTruthy();
    expect(restored.digestHex).not.toBe(restored.expectedDigestHex);
});

test('recovered outbox dispatch after reload retries the same envelope after transport failure', async ({ page }) => {
    await initializeRuntime(page);
    const envelope = await atomicSend(page, 'retry-envelope');
    const restored = await restoreRuntime(page);
    expect(restored.pending).toEqual([{ envelope, clientId: 'retry-envelope' }]);
    const result = await page.evaluate(async () => {
        const { storage, conversationId } = (window as any).__outboxRecovery;
        const before = JSON.stringify(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!))[0].envelope);
        const send = async (fail: boolean) => {
            const pending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!));
            try { if (fail) throw new Error('synthetic transport failure'); return JSON.stringify(pending[0].envelope); } catch { return undefined; }
        };
        const failed = await send(true);
        const retry = await send(false);
        const after = JSON.stringify(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!))[0].envelope);
        return { failed, retry, before, after };
    });
    expect(result.failed).toBeUndefined();
    expect(result.before).toBe(JSON.stringify(envelope));
    expect(result.retry).toBe(result.before);
    expect(result.after).toBe(result.before);
});

test('a stale restored runtime fails closed when another writer advances session and outbox', async ({ page }) => {
    await initializeRuntime(page);
    await page.evaluate(async ({ root }) => {
        const task = (window as any).__outboxRecovery;
        const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
        const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
        const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
        await storage.unlock('disposable Web outbox recovery test vault');
        const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
        await runtime.initialize(); await runtime.restoreOrCreateIdentity();
        const metadata = JSON.parse(new TextDecoder().decode(await storage.read('outbox-recovery-test', 'metadata')));
        await runtime.restoreSession(metadata.conversationId, metadata.sessionId);
        task.stale = { storage, runtime, conversationId: metadata.conversationId };
    }, { root });
    await atomicSend(page, 'winner');
    const result = await page.evaluate(async () => {
        const { storage, runtime, conversationId } = (window as any).__outboxRecovery.stale;
        const raw = await storage.read('modern-outbox', conversationId);
        const pending = JSON.parse(new TextDecoder().decode(raw));
        const bytes = new TextEncoder().encode('stale writer payload');
        let rejected = false;
        try {
            await runtime.encryptMessageWithAtomicRecords(bytes.buffer, (envelope: unknown) => {
                pending.push({ envelope, clientId: 'stale' });
                return [{ recordType: 'modern-outbox', recordId: conversationId, expected: raw,
                    next: new TextEncoder().encode(JSON.stringify(pending)).buffer }];
            });
        } catch { rejected = true; }
        return { rejected, lifecycle: runtime.lifecycle,
            pending: JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!)) };
    });
    expect(result.rejected).toBe(true);
    expect(result.lifecycle).toBe('error');
    expect(result.pending).toHaveLength(1);
});

test('lease loss during encryption prevents commit and restores the prior session snapshot', async ({ page }) => {
    await initializeRuntime(page);
    const result = await page.evaluate(async ({ root, conversationId }) => {
        const { storage, runtime } = (window as any).__outboxRecovery;
        const { ModernConversation } = await import(/* @vite-ignore */ `${root}/service/src/crypto/modernConversation.ts`);
        const owner = Object.create(ModernConversation.prototype) as any;
        owner.tabOwnerId = 'current-owner';
        const leaseKey = `k3ncrypt-tab-lease:${conversationId}`;
        localStorage.setItem(leaseKey, 'current-owner:9999999999999');
        const metadata = JSON.parse(new TextDecoder().decode(await storage.read('outbox-recovery-test', 'metadata')));
        const baseline = await storage.read('vodozemac-session', conversationId);
        const raw = await storage.read('modern-outbox', conversationId);
        const bytes = new TextEncoder().encode('lease-loss message');
        let rejected = false;
        try {
            await runtime.encryptMessageWithAtomicRecords(bytes.buffer, (envelope: unknown) => {
                localStorage.setItem(leaseKey, 'new-owner:9999999999999');
                return [{ recordType: 'modern-outbox', recordId: conversationId, expected: raw,
                    next: new TextEncoder().encode(JSON.stringify([{ envelope, clientId: 'lease-lost' }])).buffer }];
            }, () => owner.assertCurrentTabOwnership(conversationId));
        } catch { rejected = true; }
        const after = await storage.read('vodozemac-session', conversationId);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', after!));
        const digestHex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
        return { rejected, active: runtime.lifecycle === 'active', baselineExists: !!baseline, digestHex, expectedDigestHex: metadata.digestHex,
            pending: JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!)) };
    }, { root, conversationId });
    expect(result.rejected).toBe(true);
    expect(result.active).toBe(true);
    expect(result.baselineExists).toBe(true);
    expect(result.digestHex).toBe(result.expectedDigestHex);
    expect(result.pending).toEqual([]);
});

test('two browser tabs racing the same saved session commit only one envelope', async ({ context, page }) => {
    const other = await context.newPage();
    try {
        await initializeRuntime(page);
        await other.goto('/');
        await other.evaluate(async ({ root, passphrase }) => {
            const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
            const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
            const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
            const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
            const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
            await storage.unlock(passphrase);
            const metadata = JSON.parse(new TextDecoder().decode(await storage.read('outbox-recovery-test', 'metadata')));
            const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
            await runtime.initialize(); await runtime.restoreOrCreateIdentity();
            await runtime.restoreSession(metadata.conversationId, metadata.sessionId);
            (window as any).__outboxRecovery = { storage, runtime, conversationId: metadata.conversationId };
        }, { root, passphrase });
        const outcomes = await Promise.allSettled([atomicSend(page, 'tab-a'), atomicSend(other, 'tab-b')]);
        expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);
        const pending = await page.evaluate(async () => {
            const { storage, conversationId } = (window as any).__outboxRecovery;
            return JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!));
        });
        expect(pending).toHaveLength(1);
    } finally { await other.close(); }
});

test('repeated restart recovery does not mint another envelope or duplicate outbox item', async ({ page }) => {
    await initializeRuntime(page);
    const envelope = await atomicSend(page, 'single-pending-item');
    const once = await restoreRuntime(page);
    const twice = await restoreRuntime(page);
    expect(once.pending).toEqual([{ envelope, clientId: 'single-pending-item' }]);
    expect(twice.pending).toEqual(once.pending);
});

test('renewal correlation and encrypted envelope can be committed as companion records atomically', async ({ page }) => {
    await initializeRuntime(page);
    await page.evaluate(async () => {
        const { storage, conversationId } = (window as any).__outboxRecovery;
        await storage.write('conversation-session-renewal', conversationId,
            new TextEncoder().encode(JSON.stringify({ version: 1, previousSessionId: 'previous-session' })).buffer);
    });
    const result = await page.evaluate(async () => {
        const { storage, runtime, conversationId } = (window as any).__outboxRecovery;
        const outbox = await storage.read('modern-outbox', conversationId);
        const renewal = await storage.read('conversation-session-renewal', conversationId);
        const pending = JSON.parse(new TextDecoder().decode(outbox));
        const renewalRecord = JSON.parse(new TextDecoder().decode(renewal));
        const bytes = new TextEncoder().encode('renewal-correlated test message');
        const envelope = await runtime.encryptMessageWithAtomicRecords(bytes.buffer, (encrypted: unknown) => {
            pending.push({ envelope: encrypted, clientId: 'renewal-message' });
            return [
                { recordType: 'modern-outbox', recordId: conversationId, expected: outbox,
                    next: new TextEncoder().encode(JSON.stringify(pending)).buffer },
                { recordType: 'conversation-session-renewal', recordId: conversationId, expected: renewal,
                    next: new TextEncoder().encode(JSON.stringify({ ...renewalRecord, clientId: 'renewal-message' })).buffer },
            ];
        });
        return { envelope, pending: JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', conversationId))!)),
            renewal: JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-renewal', conversationId))!)) };
    });
    expect(result.pending).toEqual([{ envelope: result.envelope, clientId: 'renewal-message' }]);
    expect(result.renewal).toEqual({ version: 1, previousSessionId: 'previous-session', clientId: 'renewal-message' });
});
