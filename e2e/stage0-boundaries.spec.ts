import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
const root = `/@fs${resolve('.')}`;

for (const boundary of ['A', 'B', 'C', 'D', 'E', 'F']) {
    test(`real WASM / encrypted IndexedDB restart boundary ${boundary}`, async ({ page }) => {
        await page.goto('/');
        const before = await page.evaluate(async ({ root, boundary }) => {
            const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
            const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
            const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
            const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
            const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
            await storage.initializeWithPassphrase('stage0 disposable test vault');
            const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
            await runtime.initialize(); await runtime.restoreOrCreateIdentity();
            const bindings = await loadVodozemacBindings();
            const recipient = bindings.accountFactory.createAccount();
            recipient.generateOneTimeKeys(1);
            const identity = JSON.parse(recipient.identityKeys());
            await runtime.establishOutboundSession('stage0', identity.curve25519, recipient.availableOneTimeKeys()[0]);
            const sessionId = runtime.activeSessionId;
            await storage.write('test', 'session-id', new TextEncoder().encode(sessionId).buffer);
            const original = await storage.read('vodozemac-session', 'stage0');
            await storage.write('test', 'original', original);
            const write = storage.write.bind(storage);
            let mutated = false;
            if (boundary === 'B') storage.write = async (type: string, id: string, bytes: ArrayBuffer) => {
                if (type === 'vodozemac-session') { mutated = true; throw new Error('injected durable session failure'); }
                return write(type, id, bytes);
            };
            let rejected = false;
            let submitted = false;
            if (boundary !== 'A') {
                try {
                    const wire = await runtime.encrypt('message', new TextEncoder().encode('synthetic test message').buffer);
                    if (['D', 'E', 'F'].includes(boundary)) {
                        const bytes = new TextEncoder().encode(JSON.stringify(wire)).buffer;
                        await storage.write('modern-outbox', 'stage0', bytes);
                        // Test-owned transport sink: no live relay/interoperability claim.
                        if (['E', 'F'].includes(boundary)) { submitted = true; await storage.write('test', 'submitted', bytes); }
                    }
                } catch { rejected = true; }
            }
            return { rejected, mutated, submitted, marker: !!await storage.read('vodozemac-commit', 'local') };
        }, { root, boundary });
        expect(before.rejected).toBe(boundary === 'B');
        expect(before.mutated).toBe(boundary === 'B');
        expect(before.marker).toBe(boundary === 'B');
        expect(before.submitted).toBe(['E', 'F'].includes(boundary));
        // Abrupt document destruction, not graceful runtime.close(): real persistence is reopened.
        await page.reload();
        const after = await page.evaluate(async (root) => {
            const { BrowserSecureStorage } = await import(/* @vite-ignore */ `${root}/service/src/storage/secureVault.ts`);
            const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
            const { VodozemacRuntime } = await import(/* @vite-ignore */ `${root}/service/src/crypto/vodozemacRuntime.ts`);
            const { loadVodozemacBindings } = await import(/* @vite-ignore */ `${root}/client/src/crypto/vodozemacModule.ts`);
            const storage = new BrowserSecureStorage(new IndexedDbVaultPersistence());
            await storage.unlock('stage0 disposable test vault');
            const runtime = new VodozemacRuntime(storage, loadVodozemacBindings);
            await runtime.initialize(); await runtime.restoreOrCreateIdentity();
            const saved = await storage.read('vodozemac-session', 'stage0');
            const original = await storage.read('test', 'original');
            const pending = await storage.read('modern-outbox', 'stage0');
            const submitted = await storage.read('test', 'submitted');
            const equal = (a: ArrayBuffer, b: ArrayBuffer) => JSON.stringify(Array.from(new Uint8Array(a))) === JSON.stringify(Array.from(new Uint8Array(b)));
            let restored = false;
            if (saved) { await runtime.restoreSession('stage0', new TextDecoder().decode(await storage.read('test', 'session-id'))); restored = true; }
            return { restored, changed: !!saved && !equal(saved, original), pending: !!pending,
                identicalRetry: !!submitted && !!pending && equal(submitted, pending), marker: !!await storage.read('vodozemac-commit', 'local') };
        }, root);
        expect(after.restored).toBe(boundary !== 'B');
        expect(after.changed).toBe(!['A', 'B'].includes(boundary));
        expect(after.pending).toBe(['D', 'E', 'F'].includes(boundary));
        expect(after.identicalRetry).toBe(['E', 'F'].includes(boundary));
        expect(after.marker).toBe(false);
    });
}

test('two real pages: expired owner heartbeat cannot replace the new lease', async ({ context }) => {
    const a = await context.newPage(); const b = await context.newPage();
    await a.goto('/'); await b.goto('/');
    const enter = async (page: typeof a) => page.evaluate(async (root) => {
        const { ModernConversation } = await import(/* @vite-ignore */ `${root}/service/src/crypto/modernConversation.ts`);
        const owner = new ModernConversation({}, async () => ({}), {});
        (window as any).__stage0owner = owner;
        await owner.withTabLock('stage0-owner', async () => undefined);
        return owner.tabOwnerId;
    }, root);
    const first = await enter(a);
    await a.evaluate((id) => localStorage.setItem('k3ncrypt-tab-lease:stage0-owner', `${id}:0`), first);
    const second = await enter(b);
    const preserved = await a.evaluate((id) => {
        (window as any).__stage0owner.refreshFallbackLease(localStorage, 'k3ncrypt-tab-lease:stage0-owner');
        return localStorage.getItem('k3ncrypt-tab-lease:stage0-owner')?.startsWith(`${id}:`);
    }, second);
    expect(preserved).toBe(true);
});

test('IndexedDB transaction failure leaves both records unchanged across reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (root) => {
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const store = new IndexedDbVaultPersistence();
        await store.writeRecord('stage0-session', 'old'); await store.writeRecord('stage0-outbox', 'old');
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
            if (key === 'stage0-outbox') { this.transaction.abort(); throw new DOMException('injected transaction failure', 'AbortError'); }
            return original.call(this, value, key);
        };
        try { await store.compareAndSwapRecords([{ key: 'stage0-session', expected: 'old', next: 'new' }, { key: 'stage0-outbox', expected: 'old', next: 'new' }]); } catch { /* expected abort */ }
        finally { IDBObjectStore.prototype.put = original; }
    }, root);
    await page.reload();
    expect(await page.evaluate(async (root) => {
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ `${root}/service/src/storage/persistence.ts`);
        const store = new IndexedDbVaultPersistence();
        return [await store.readRecord('stage0-session'), await store.readRecord('stage0-outbox')];
    }, root)).toEqual(['old', 'old']);
});
