import type { CryptoSession } from '../core/contracts';
import { DeviceContextAuthority } from '../devices/authenticatedContext';
import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import type { GroupMembershipSnapshot } from './contracts';
import { SecureStorageGroupRuntimeAdapter } from './persistence';
import { groupMembershipDigest } from './protocol';
import { GroupSecurityRuntime } from './runtime';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });
const session: CryptoSession = { ready: true, encrypted: true, initialize: async () => undefined, encrypt: async () => { throw new Error('unused'); }, decrypt: async () => { throw new Error('unused'); }, destroy: () => undefined };

it('atomically advances transcript and key state and excludes a removed member', async () => {
    const vault = new BrowserSecureStorage(new MemoryVaultPersistence()); await vault.initializeWithPassphrase('test-only-group-storage');
    const adapter = new SecureStorageGroupRuntimeAdapter(vault); const runtime = new GroupSecurityRuntime(adapter, adapter);
    const initial: GroupMembershipSnapshot = { group: { groupId: 'group-production-1', version: 1, genesisCommitment: 'a'.repeat(64), epoch: 0 }, transcriptCommitment: 'b'.repeat(64), members: [
        { memberId: 'admin', userIdentityReference: 'identity-a', deviceId: 'device-a', state: 'active', role: 'administrator' },
        { memberId: 'member-b', userIdentityReference: 'identity-b', deviceId: 'device-b', state: 'active', role: 'member' },
    ] };
    const context = new DeviceContextAuthority(session, initial.group.groupId, { deviceId: 'device-a', identityReference: 'identity-a', userScope: 'account', verified: true }).localContext();
    await runtime.create(initial, context); const oldKey = await adapter.keyForActiveMember(initial.group.groupId, 'member-b');
    const unsigned = { version: 1 as const, eventId: 'remove-member-b-0001', operation: 'remove' as const, authorization: { groupId: initial.group.groupId, actorDeviceId: 'device-a', targetDeviceId: 'device-b', epoch: 0, expiresAt: Date.now() + 60_000, action: 'remove' as const }, targetDeviceId: 'device-b', epoch: 0, transcriptCommitment: initial.transcriptCommitment, createdAt: Date.now() };
    const next = await runtime.remove({ ...unsigned, digest: await groupMembershipDigest(unsigned) }, context);
    expect(next.transcriptCommitment).not.toBe(initial.transcriptCommitment);
    await expect(adapter.keyForActiveMember(initial.group.groupId, 'member-b')).rejects.toThrow('rejected');
    expect(await adapter.keyForActiveMember(initial.group.groupId, 'admin')).not.toBe(oldKey);
});
