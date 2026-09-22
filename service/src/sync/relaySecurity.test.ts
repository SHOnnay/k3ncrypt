import type { CryptoSession, SecureStorage } from '../core/contracts';
import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { DeviceTrustEnforcer } from '../devices/trust';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { createDeviceList } from '../devices/deviceList';
import { AuthenticatedSyncTransport } from './authenticatedTransport';
import { RuntimeSyncController } from './runtime';
import { encodeSyncPackage } from './codec';
import type { SyncCheckpoint, SyncDurableState, SyncPackage, SyncPersistence, SyncPersistenceTransaction } from './contracts';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });
const id = (value: string) => value.padEnd(16, '0');

/** Test adapter exercising real vault encryption and CAS, not a production adapter claim. */
class VaultTestPersistence implements SyncPersistence {
    readonly durable = true as const;
    constructor(private readonly vault: SecureStorage) {}
    private async load(): Promise<{ state?: SyncDurableState; claims: string[] }> {
        const raw = await this.vault.read('sync-test', 'local');
        return raw ? JSON.parse(new TextDecoder().decode(raw)) : { claims: [] };
    }
    async read(): Promise<SyncCheckpoint | undefined> { return (await this.load()).state?.checkpoint; }
    async readState(): Promise<SyncDurableState | undefined> { return (await this.load()).state; }
    async write(): Promise<void> { throw new Error('transaction required'); }
    async writeState(): Promise<void> { throw new Error('transaction required'); }
    async claim(): Promise<boolean> { throw new Error('transaction required'); }
    async transaction<T>(_scope: string, expected: SyncCheckpoint | undefined, operation: (tx: SyncPersistenceTransaction) => Promise<T>): Promise<T> {
        const raw = await this.vault.read('sync-test', 'local');
        const state: { state?: SyncDurableState; claims: string[] } = raw ? JSON.parse(new TextDecoder().decode(raw)) : { claims: [] };
        if (state.state && JSON.stringify(state.state.checkpoint) !== JSON.stringify(expected)) throw new Error('stale');
        const result = await operation({
            claim: async (_scope, key) => { if (state.claims.includes(key)) return false; state.claims.push(key); return true; },
            write: async () => undefined,
            writeState: async (_scope, value) => { state.state = value; },
        });
        if (!await this.vault.compareAndSwapRecords!([{ recordType: 'sync-test', recordId: 'local', expected: raw, next: new TextEncoder().encode(JSON.stringify(state)).buffer }])) throw new Error('CAS conflict');
        return result;
    }
}

it('rejects wrong recipient, stale epoch, invalid sequence, and replay after vault restart on the authenticated endpoint', async () => {
    const persistence = new MemoryVaultPersistence();
    const vault = new BrowserSecureStorage(persistence);
    await vault.initializeWithPassphrase('test-only-sync-passphrase');
    const lifecycle = new SecureStorageDeviceLifecyclePersistence(vault);
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 0, previousCommitment: null, devices: ['a', 'b'].map((name) => createDeviceEntry({ deviceId: `device-${name}`, publicIdentityReference: `identity-${name}`, algorithm: 'vodozemac-v1', state: 'active', createdAt: 1 })) });
    const snapshot = await lifecycle.initialize('user', list);
    const checkpoint = { epoch: 0, commitment: snapshot.commitment };
    const trust = new DeviceTrustEnforcer(lifecycle, 'user', 'device-b', 'identity-b');
    const authorization = { version: 1 as const, authorizationId: id('authorization'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint, transferId: id('transfer'), expiresAt: Date.now() + 60000 };
    const controller = new RuntimeSyncController('user', 'device-b', trust, new VaultTestPersistence(vault));
    await controller.authorize(authorization); await controller.prepared(); await controller.ready(); await controller.begin();
    const original: SyncPackage = { version: 1, purpose: 'sync-chunk', scope: 'user', sender: 'device-a', senderIdentity: 'identity-a', receiver: 'device-b', receiverIdentity: 'identity-b', checkpoint, streamId: id('stream'), sequence: 1, messageId: id('message'), transferId: authorization.transferId, payload: { data: Buffer.alloc(32768).toString('base64url') } };
    let pkg = original;
    // Crypto authenticity itself is covered by existing Vodozemac suites; this fixture supplies decrypted frames.
    const session: CryptoSession = { ready: true, encrypted: true, initialize: async () => undefined, destroy: () => undefined,
        encrypt: async () => { throw new Error('unused'); }, decrypt: async () => encodeSyncPackage(pkg) };
    const binding = { session, sessionBinding: 'test-session', localIdentityReference: 'identity-b', peerIdentityReference: 'identity-a', peerDeviceId: 'device-a' };
    const wire = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'fixture' } };
    const transport = new AuthenticatedSyncTransport(binding, { send: async () => undefined }, 'user', 'device-b', trust);
    pkg = { ...original, receiver: 'device-c' };
    await expect(transport.receive(wire, 'device-a')).rejects.toThrow('identity');
    pkg = { ...original, sequence: 0 };
    await expect(transport.receive(wire, 'device-a')).rejects.toThrow();
    pkg = { ...original, checkpoint: { ...checkpoint, epoch: 1 } };
    await expect(transport.receive(wire, 'device-a')).rejects.toThrow('checkpoint');
    pkg = original;
    await controller.receiveAuthenticated(await transport.receive(wire, 'device-a'));
    vault.lock();
    const restarted = new BrowserSecureStorage(persistence);
    await restarted.unlock('test-only-sync-passphrase');
    const restoredTrust = new DeviceTrustEnforcer(new SecureStorageDeviceLifecyclePersistence(restarted), 'user', 'device-b', 'identity-b');
    const restored = new RuntimeSyncController('user', 'device-b', restoredTrust, new VaultTestPersistence(restarted));
    await restored.recover(); await restored.authorize(authorization); await restored.prepared(); await restored.ready(); await restored.begin();
    const restoredTransport = new AuthenticatedSyncTransport(binding, { send: async () => undefined }, 'user', 'device-b', restoredTrust);
    await expect(restored.receiveAuthenticated(await restoredTransport.receive(wire, 'device-a'))).rejects.toThrow('replayed');
});
