import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { createDeviceList } from '../devices/deviceList';
import { deviceListCommitment } from '../devices/canonicalEncoding';
import { SecureSyncPersistence } from './persistence';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });
const decode = (value: ArrayBuffer | undefined) => value ? JSON.parse(new TextDecoder().decode(value)) : undefined;

it('imports all authenticated application record kinds in the replay transaction and rolls back invalid input', async () => {
    const vault = new BrowserSecureStorage(new MemoryVaultPersistence()); await vault.initializeWithPassphrase('test-only-application-sync');
    const store = new SecureSyncPersistence(vault);
    const list = createDeviceList({ version: 1, identityReference: 'account-sync', epoch: 0, previousCommitment: null, devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'v1', state: 'active', createdAt: 1 })] });
    const checkpoint = { epoch: 0, commitment: await deviceListCommitment(list) };
    const base = { version: 1 as const, scope: 'account-sync', epoch: 0, commitment: checkpoint.commitment };
    const records = [
        { ...base, recordId: 'conversation0001', kind: 'conversation' as const, payload: { conversationId: 'conversation-local', protocol: 'modern', localAddress: 'local-address-0001', remoteAddress: 'remote-address-001' } },
        { ...base, recordId: 'contact000000001', kind: 'contact' as const, payload: { contactId: 'contact-address-01', identityId: 'identity-contact', algorithm: 'v1', publicKey: Buffer.alloc(32, 7).toString('base64url'), verification: 'unverified', changeStatus: 'unchanged' } },
        { ...base, recordId: 'device0000000001', kind: 'device' as const, payload: { state: { list, commitment: checkpoint.commitment } } },
        { ...base, recordId: 'settings00000001', kind: 'settings' as const, payload: { theme: 'paper-ink', analytics: false, backgroundCapture: false, externalMedia: false } },
    ];
    await store.transaction('account-sync', undefined, async (tx) => { expect(await tx.claim('account-sync', 'authenticated-import-1')).toBe(true); await tx.importRecords?.('account-sync', checkpoint, records); });
    expect(decode(await vault.read('conversation-protocol', 'conversation-local'))?.mode).toBe('modern');
    expect(decode(await vault.read('contact-identity', 'contact-address-01'))?.identityId).toBe('identity-contact');
    expect(decode(await vault.read('application-settings', 'local'))?.privacy.analytics).toBe(false);
    await expect(store.transaction('account-sync', undefined, async (tx) => { await tx.claim('account-sync', 'authenticated-import-2'); await tx.importRecords?.('account-sync', checkpoint, records); })).rejects.toThrow('already imported');
    const invalid = [{ ...records[3], recordId: 'settings00000002', scope: 'attacker-scope' }];
    await expect(store.transaction('account-sync', undefined, async (tx) => { await tx.claim('account-sync', 'rollback-claim'); await tx.importRecords?.('account-sync', checkpoint, invalid); })).rejects.toThrow();
    await store.transaction('account-sync', undefined, async (tx) => { expect(await tx.claim('account-sync', 'rollback-claim')).toBe(true); });
});
