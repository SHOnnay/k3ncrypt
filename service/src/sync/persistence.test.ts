import { SecureSyncPersistence } from './persistence';
import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import type { SyncDurableState, SyncPersistenceTransaction } from './contracts';
import { RuntimeSyncController } from './runtime';
import { createDeviceEntry, createDeviceList, deviceListCommitment } from '../devices';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });
const checkpoint = { epoch: 0, commitment: 'a'.repeat(64) };
const state: SyncDurableState = { version: 1, scope: 'account', checkpoint, admission: 'transfer', receivedSequences: [1] };
const setup = async () => {
    const disk = new MemoryVaultPersistence();
    const vault = new BrowserSecureStorage(disk);
    await vault.initializeWithPassphrase('test-only-sync-storage');
    return { disk, vault, store: new SecureSyncPersistence(vault) };
};

describe('production encrypted sync persistence', () => {
    it('invalidates runtime admission after a failed commit and does not restore peer admission on restart', async () => {
        const { store } = await setup();
        const list = createDeviceList({ version: 1, identityReference: 'account', epoch: 0, previousCommitment: null, devices: ['a', 'b'].map((id) => createDeviceEntry({ deviceId: `device-${id}`, publicIdentityReference: `identity-${id}`, algorithm: 'v', state: 'active', createdAt: 1 })) });
        const current = { list, commitment: await deviceListCommitment(list) };
        const trust = { snapshot: async () => current, assertTrustedAt: async (epoch: number) => { if (epoch !== list.epoch) throw new Error('Stale'); } };
        const controller = new RuntimeSyncController('account', 'device-b', trust, store);
        await controller.authorize({ version: 1, authorizationId: 'authorization000', scope: 'account', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint: { epoch: 0, commitment: current.commitment }, transferId: 'transfer00000000', expiresAt: Date.now() + 10000 });
        const write = jest.spyOn(store, 'transaction').mockRejectedValueOnce(new Error('simulated storage failure'));
        await expect(controller.prepared()).rejects.toThrow('storage failure');
        write.mockRestore();
        await expect(controller.ready()).rejects.toThrow('unavailable');
        await expect(controller.begin()).rejects.toThrow('unavailable');
        expect((await store.readState('account'))?.admission).toBe('prepare');
        const restarted = new RuntimeSyncController('account', 'device-b', trust, store);
        await restarted.recover();
        await expect(restarted.prepared()).rejects.toThrow('unavailable');
        await expect(restarted.begin()).rejects.toThrow('unavailable');
    });
    it('commits progress and replay together, preserves them across vault restart, and stores ciphertext only', async () => {
        const { disk, vault, store } = await setup();
        await store.transaction('account', undefined, async (tx) => {
            expect(await tx.claim('account', 'sender:receiver:stream:1')).toBe(true);
            await tx.writeState('account', state);
        });
        expect(disk.inspectRecord('sync-runtime:account')).not.toContain('sender:receiver:stream:1');
        expect(disk.inspectRecord('sync-runtime:account')).not.toContain('receivedSequences');
        vault.lock();
        const reopened = new BrowserSecureStorage(disk);
        await reopened.unlock('test-only-sync-storage');
        const restored = new SecureSyncPersistence(reopened);
        expect(await restored.readState('account')).toEqual(state);
        await restored.transaction('account', checkpoint, async (tx) => {
            expect(await tx.claim('account', 'sender:receiver:stream:1')).toBe(false);
        });
    });

    it('rolls back claims when a transaction fails before the commit', async () => {
        const { store } = await setup();
        await expect(store.transaction('account', undefined, async (tx) => {
            await tx.claim('account', 'not-committed');
            await tx.writeState('account', state);
            throw new Error('simulated crash');
        })).rejects.toThrow('simulated crash');
        expect(await store.readState('account')).toBeUndefined();
        await store.transaction('account', undefined, async (tx) => {
            expect(await tx.claim('account', 'not-committed')).toBe(true);
            await tx.writeState('account', state);
        });
    });

    it('rejects stale concurrent writers across separate vault instances without partial claims', async () => {
        const { disk, store } = await setup();
        const secondVault = new BrowserSecureStorage(disk);
        await secondVault.unlock('test-only-sync-storage');
        const second = new SecureSyncPersistence(secondVault);
        let arrived = 0;
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        const write = (adapter: SecureSyncPersistence, key: string) => adapter.transaction('account', undefined, async (tx) => {
            await tx.claim('account', key);
            await tx.writeState('account', state);
            if (++arrived === 2) release();
            await barrier;
        });
        const results = await Promise.allSettled([write(store, 'one'), write(second, 'two')]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        await store.transaction('account', checkpoint, async (tx) => {
            expect([await tx.claim('account', 'one'), await tx.claim('account', 'two')].filter(Boolean)).toHaveLength(1);
        });
    });

    it('rejects corrupted checkpoints, same-epoch forks and direct nontransactional writes', async () => {
        const { vault, store } = await setup();
        await store.transaction('account', undefined, async (tx) => { await tx.writeState('account', state); });
        await expect(store.transaction('account', checkpoint, async (tx) => { await tx.write('account', { epoch: 0, commitment: 'b'.repeat(64) }); })).rejects.toThrow('checkpoint');
        await expect(store.claim()).rejects.toThrow('transaction');
        const bytes = await vault.read('sync-runtime', 'account');
        const stored = JSON.parse(new TextDecoder().decode(bytes));
        stored.state.checkpoint = { epoch: 1, commitment: 'b'.repeat(64) };
        await vault.write('sync-runtime', 'account', new TextEncoder().encode(JSON.stringify(stored)).buffer);
        await expect(store.readState('account')).rejects.toThrow('corrupted');
    });

    it('rejects malformed progress before committing its replay claim', async () => {
        const { store } = await setup();
        for (const malformed of [
            { ...state, receivedSequences: [1, 1] },
            { ...state, readyMembers: ['unknown'] },
            { ...state, terminal: 'completed' as const },
        ]) {
            await expect(store.transaction('account', undefined, async (tx) => {
                await tx.claim('account', 'reusable-after-abort');
                await tx.writeState('account', malformed);
            })).rejects.toThrow('corrupted');
            expect(await store.read('account')).toBeUndefined();
        }
        await store.transaction('account', undefined, async (tx) => {
            expect(await tx.claim('account', 'reusable-after-abort')).toBe(true);
            await tx.writeState('account', state);
        });
    });

    it('closes transaction handles and rejects checkpoint-only partial advancement', async () => {
        const { store } = await setup();
        let escaped!: SyncPersistenceTransaction;
        await store.transaction('account', undefined, async (tx) => {
            escaped = tx;
            await tx.writeState('account', state);
        });
        await expect(escaped.claim('account', 'late')).rejects.toThrow('closed');
        await expect(store.transaction('account', checkpoint, async (tx) => {
            await tx.write('account', { epoch: 1, commitment: 'b'.repeat(64) });
        })).rejects.toThrow('corrupted');
        expect(await store.readState('account')).toEqual(state);
    });

    it('imports validated records with replay and checkpoint atomically', async () => {
        const { store } = await setup();
        const record = { version: 1 as const, scope: 'account', recordId: 'record-000000001', kind: 'settings' as const, epoch: 0, commitment: checkpoint.commitment, payload: { theme: 'paper-ink' } };
        await store.transaction('account', undefined, async (tx) => {
            expect(await tx.claim('account', 'import-sequence-1')).toBe(true);
            await tx.importRecords?.('account', checkpoint, [record]);
            await tx.writeState('account', state);
        });
        expect(await store.readRecords('account')).toEqual([record]);
        await expect(store.transaction('account', checkpoint, async (tx) => {
            await tx.claim('account', 'import-sequence-2');
            await tx.importRecords?.('account', checkpoint, [record]);
        })).rejects.toThrow('already imported');
        expect(await store.readRecords('account')).toEqual([record]);
    });
});
