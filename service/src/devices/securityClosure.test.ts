import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import { canonicalIdentityRecordId } from '../identity/machineIdentity';
import { loadAccountBinding } from '../identity/accountBinding';
import { SecureStorageDeviceLifecyclePersistence, decodeDeviceControl } from './runtime';
import { createDeviceList } from './deviceList';
import { createDeviceEntry } from './deviceIdentity';
import { DeviceContextAuthority, assertIssuedDeviceContext } from './authenticatedContext';
import type { CryptoSession } from '../core/contracts';
Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const list = (scope: string) => createDeviceList({ version: 1, identityReference: scope, epoch: 0, previousCommitment: null,
    devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'K3 ABC DEF', algorithm: 'vodozemac-v1', state: 'active', createdAt: 1 })] });

describe('security closure real encrypted vault boundary', () => {
    it('uses stable machine addresses for fingerprints and a separate account scope across restart', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase('test-only-long-passphrase');
        const id = await canonicalIdentityRecordId('K3 ABC DEF');
        expect(id).toMatch(/^identity-[0-9a-f]{64}$/);
        expect(await canonicalIdentityRecordId('K3 ABC DEF')).toBe(id);
        expect(await canonicalIdentityRecordId('legacy-id')).toBe('legacy-id');
        const binding = await loadAccountBinding(vault, 'K3 ABC DEF');
        expect(binding.userScope).not.toBe(binding.identityReference);
        const lifecycle = new SecureStorageDeviceLifecyclePersistence(vault);
        await lifecycle.initialize('K3 ABC DEF', list('K3 ABC DEF'));
        vault.lock();
        const restarted = new BrowserSecureStorage(persistence);
        await restarted.unlock('test-only-long-passphrase');
        expect(await loadAccountBinding(restarted, 'K3 ABC DEF')).toEqual(binding);
        expect((await new SecureStorageDeviceLifecyclePersistence(restarted).read('K3 ABC DEF'))?.list.epoch).toBe(0);
    });

    it('rejects lost lifecycle state and persists future epoch suspension across restart', async () => {
        const vault = new BrowserSecureStorage(new MemoryVaultPersistence());
        await vault.initializeWithPassphrase('test-only-long-passphrase');
        const lifecycle = new SecureStorageDeviceLifecyclePersistence(vault);
        await lifecycle.initialize('user-a', list('user-a'));
        await vault.delete('device-lifecycle', 'user-a');
        await expect(lifecycle.initialize('user-a', list('user-a'))).rejects.toThrow('missing');
        await lifecycle.initialize('user-b', list('user-b'));
        await lifecycle.suspendTrust('user-b', 2, 'f'.repeat(64));
        await expect(new SecureStorageDeviceLifecyclePersistence(vault).read('user-b')).rejects.toThrow('rollback');
    });

    it('compares all records atomically across two unlocked vault instances', async () => {
        const persistence = new MemoryVaultPersistence();
        const first = new BrowserSecureStorage(persistence);
        await first.initializeWithPassphrase('test-only-long-passphrase');
        const second = new BrowserSecureStorage(persistence);
        await second.unlock('test-only-long-passphrase');
        const updates = (next: string) => ['state', 'highwater'].map((recordId) => ({ recordType: 'test', recordId, expected: undefined, next: bytes(next) }));
        const results = await Promise.all([first.compareAndSwapRecords(updates('one')), second.compareAndSwapRecords(updates('two'))]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await first.read('test', 'state')).toEqual(await second.read('test', 'highwater'));
        await expect(first.compareAndSwapRecords(updates('stale'))).resolves.toBe(false);
    });

    it('rejects duplicate public identity under different device identifiers', () => {
        const original = list('user');
        expect(() => createDeviceList({ ...original, devices: [...original.devices, { ...original.devices[0], deviceId: 'device-b' }] })).toThrow();
    });
});

describe('authenticated lifecycle proof boundary', () => {
    it('rejects structural contexts and binds remote proof to decrypted payload', async () => {
        const payload = { authorDeviceId: 'device-a', targetDeviceId: 'device-b' };
        const session: CryptoSession = { encrypted: true, ready: true, initialize: async () => undefined,
            encrypt: async () => { throw new Error('unused'); }, destroy: () => undefined,
            decrypt: async () => bytes(`k3ncrypt-device-control-v1:${JSON.stringify({ type: 'enrollment-approval', payload })}`) };
        const identity = { deviceId: 'device-a', identityReference: 'identity-a', userScope: 'user', verified: true };
        const authority = new DeviceContextAuthority(session, 'conversation', identity, identity);
        const { context } = await authority.receive({ version: 1, strategy: 'test', data: {} });
        expect(() => assertIssuedDeviceContext(context, payload)).not.toThrow();
        expect(() => assertIssuedDeviceContext({ ...context }, payload)).toThrow('Invalid authenticated');
        expect(() => assertIssuedDeviceContext(context, { ...payload, targetDeviceId: 'attacker' })).toThrow('mismatch');
        expect(() => decodeDeviceControl(bytes('k3ncrypt-device-control-v1:{'))).toThrow();
        expect(() => decodeDeviceControl(bytes('k3ncrypt-device-control-v1:{"type":"revocation","payload":{},"extra":true}'))).toThrow();
    });
});
