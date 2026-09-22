import { authorizeSync } from './authorization';
import { decodeSyncPackage, encodeSyncPackage, syncContentCommitment, syncDigest, verifyDeviceListCheckpoint, verifySyncDigest } from './codec';
import { SyncFenceCoordinator } from './fencing';
import { SyncStateMachine } from './stateMachine';
import { SyncTransferController } from './transfer';
import { RuntimeSyncController } from './runtime';
import { AuthenticatedSyncTransport, consumeAuthenticatedSyncFrame } from './authenticatedTransport';
import { validateSyncRecords } from './stateRecords';
import { createDeviceEntry, createDeviceList, deviceListCommitment } from '../devices';

const ids = (value: string): string => value.padEnd(16, '0');
const setup = async () => {
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 1, previousCommitment: 'a'.repeat(64), devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'v', state: 'active', createdAt: 1 }), createDeviceEntry({ deviceId: 'device-b', publicIdentityReference: 'identity-b', algorithm: 'v', state: 'active', createdAt: 1 })] });
    return { list, commitment: await deviceListCommitment(list) };
};
describe('Phase 6B.8 synchronization domain', () => {
    it('rejects caller-fabricated frames without trusting their identity fields', () => {
        expect(() => consumeAuthenticatedSyncFrame({ sessionBinding: 'verified', senderIdentityReference: 'identity-a', receiverIdentityReference: 'identity-b', senderDeviceId: 'device-a', syncPackage: {} as never })).toThrow('rejected');
    });
    it('round-trips authenticated package framing and rejects tampering', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment }; const value = { version: 1 as const, purpose: 'sync-manifest' as const, scope: 'user', sender: ids('device-a'), senderIdentity: 'identity-a', receiver: ids('device-b'), receiverIdentity: 'identity-b', checkpoint, streamId: ids('stream'), sequence: 1, messageId: ids('message'), transferId: ids('transfer'), payload: { version: 1, expectedChunkCount: 1, finalContentCommitment: 'b'.repeat(64) } };
        const encoded = encodeSyncPackage(value); const decoded = decodeSyncPackage(encoded); expect(decoded.purpose).toBe('sync-manifest');
        const expected = await syncDigest(decoded); expect(await verifySyncDigest(decoded, expected)).toBe(true);
        const modified = { ...decoded, payload: { digest: 'tampered' } }; expect(await verifySyncDigest(modified, expected)).toBe(false);
    });
    it('rejects stale or wrong commitments and untrusted targets', async () => {
        const state = await setup(); await expect(verifyDeviceListCheckpoint(state.list, { epoch: 0, commitment: state.commitment })).rejects.toThrow();
        const trust = { snapshot: async () => state, assertTrustedAt: async () => undefined };
        await expect(authorizeSync({ version: 1, authorizationId: ids('auth'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'wrong', checkpoint: { epoch: state.list.epoch, commitment: state.commitment }, transferId: ids('transfer'), expiresAt: Date.now() + 1000 }, trust)).rejects.toThrow();
    });
    it('requires fences from every prior member and preserves conflicts', () => {
        const checkpoint = { epoch: 2, commitment: 'b'.repeat(64) }; const fence = new SyncFenceCoordinator('user', checkpoint, ['a', 'b']);
        fence.recordFence({ attemptId: ids('attempt'), scope: 'user', checkpoint, deviceId: 'a', ledgerDigest: 'c'.repeat(64), createdAt: 1 }); expect(fence.canResume()).toBe(false);
        fence.recordConflict({ attemptId: ids('attempt'), scope: 'user', checkpoint, proposals: ['d'.repeat(64)], reason: 'fork' }); fence.recordFence({ attemptId: ids('attempt'), scope: 'user', checkpoint, deviceId: 'b', ledgerDigest: 'e'.repeat(64), createdAt: 1 }); expect(fence.canResume()).toBe(false);
        expect(fence.conflictsFor(ids('attempt'))).toBeDefined();
    });
    it('rejects invalid state transitions and suspends on uncertainty', () => { const machine = new SyncStateMachine('approved', 'created'); machine.transitionDevice('syncing'); machine.suspend(); expect(machine.device).toBe('suspended'); expect(machine.transfer).toBe('failed'); expect(() => machine.transitionDevice('revoked')).not.toThrow(); expect(() => machine.transitionTransfer('completed')).toThrow(); });
    it('authorizes a recipient-specific transfer and rejects stale package identity', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment }; const auth = { version: 1 as const, authorizationId: ids('authorization'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint, transferId: ids('transfer'), expiresAt: Date.now() + 10000 }; const trust = { snapshot: async () => state, assertTrustedAt: async () => undefined }; const transfer = new SyncTransferController(auth, trust); await transfer.authorize(); transfer.begin(); const pkg = { version: 1 as const, purpose: 'sync-chunk' as const, scope: 'user', sender: 'device-a', senderIdentity: 'identity-a', receiver: 'device-b', receiverIdentity: 'identity-b', checkpoint, streamId: ids('stream'), sequence: 2, messageId: ids('message'), transferId: auth.transferId, payload: { chunk: 'ciphertext' } }; const chunkDigest = await syncDigest(pkg); const manifest = { ...pkg, purpose: 'sync-manifest' as const, sequence: 1, messageId: ids('manifest'), payload: { version: 1, expectedChunkCount: 1, finalContentCommitment: await syncContentCommitment(auth.transferId, [{ sequence: pkg.sequence, digest: chunkDigest }]) } }; await transfer.accept(manifest); await expect(transfer.accept(pkg)).resolves.toMatchObject({ transferId: auth.transferId }); await expect(transfer.accept({ ...pkg, receiver: 'device-c' })).rejects.toThrow(); await transfer.complete(); expect(transfer.state.transfer).toBe('completed');
    });
    it('requires the declared chunk count and final content commitment before completion', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment };
        const auth = { version: 1 as const, authorizationId: ids('manifest-auth'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint, transferId: ids('manifest-transfer'), expiresAt: Date.now() + 10000 };
        const trust = { snapshot: async () => state, assertTrustedAt: async () => undefined };
        const chunk = { version: 1 as const, purpose: 'sync-chunk' as const, scope: 'user', sender: 'device-a', senderIdentity: 'identity-a', receiver: 'device-b', receiverIdentity: 'identity-b', checkpoint, streamId: ids('manifest-stream'), sequence: 2, messageId: ids('manifest-chunk'), transferId: auth.transferId, payload: { records: [] } };
        const transfer = new SyncTransferController(auth, trust); await transfer.authorize(); transfer.begin();
        await transfer.accept({ ...chunk, purpose: 'sync-manifest', sequence: 1, messageId: ids('manifest-message'), payload: { version: 1, expectedChunkCount: 1, finalContentCommitment: 'f'.repeat(64) } });
        await expect(transfer.complete()).rejects.toThrow('incomplete');
        await transfer.accept(chunk); await expect(transfer.complete()).rejects.toThrow('commitment');
    });
    it('enforces runtime target binding and durable replay claims', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment }; const trust = { snapshot: async () => state, assertTrustedAt: async () => undefined }; const claimed = new Set<string>(); let saved = checkpoint; let durableState: unknown; const persistence = { durable: true as const, claim: async (_scope: string, key: string) => !claimed.has(key) && (claimed.add(key), true), read: async () => saved, write: async (_scope: string, next: typeof checkpoint) => { saved = next; }, writeState: async (_scope: string, next: unknown) => { durableState = next; }, readState: async () => durableState as never, transaction: async <T>(_scope: string, _expected: typeof checkpoint | undefined, operation: (tx: { claim: (scope: string, key: string) => Promise<boolean>; write: (scope: string, next: typeof checkpoint) => Promise<void>; writeState: (scope: string, next: unknown) => Promise<void> }) => Promise<T>) => operation({ claim: async (_scope, key) => !claimed.has(key) && (claimed.add(key), true), write: async (_scope, next) => { saved = next; }, writeState: async (_scope, next) => { durableState = next; } }) }; const controller = new RuntimeSyncController('user', 'device-b', trust, persistence); const authorization = { version: 1 as const, authorizationId: ids('authorization'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint, transferId: ids('transfer'), expiresAt: Date.now() + 10000 }; await controller.authorize(authorization); await controller.prepared(); await controller.ready(); await controller.begin(); const pkg = { version: 1 as const, purpose: 'sync-chunk' as const, scope: 'user', sender: 'device-a', senderIdentity: 'identity-a', receiver: 'device-b', receiverIdentity: 'identity-b', checkpoint, streamId: ids('stream'), sequence: 1, messageId: ids('message'), transferId: authorization.transferId, payload: { ciphertext: 'opaque' } }; const session = { encrypted: true, ready: true, initialize: async () => undefined, destroy: () => undefined, encrypt: async () => ({ version: 1, strategy: 'test', data: '' }), decrypt: async () => encodeSyncPackage(pkg) }; const authenticated = new AuthenticatedSyncTransport({ session, sessionBinding: 'session', localIdentityReference: 'identity-b', peerIdentityReference: 'identity-a', peerDeviceId: 'device-a' }, { send: async () => undefined }, 'user', 'device-b', trust); const frame = await authenticated.receive({ version: 1, strategy: 'test', data: '' }, 'device-a'); await controller.receiveAuthenticated(frame); await expect(controller.receiveAuthenticated(frame)).rejects.toThrow('replayed'); expect(durableState).toBeDefined();
    });
    it('requires fixed-membership evidence before transfer', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment }; const claimed = new Set<string>(); let durableState: unknown;
        const persistence = { durable: true as const, claim: async (_scope: string, key: string) => !claimed.has(key) && (claimed.add(key), true), read: async () => undefined, write: async () => undefined, writeState: async (_scope: string, next: unknown) => { durableState = next; }, readState: async () => durableState as never, transaction: async <T>(_scope: string, _expected: typeof checkpoint | undefined, operation: (tx: { claim: (scope: string, key: string) => Promise<boolean>; write: (scope: string, next: typeof checkpoint) => Promise<void>; writeState: (scope: string, next: unknown) => Promise<void> }) => Promise<T>) => operation({ claim: async (_scope, key) => !claimed.has(key) && (claimed.add(key), true), write: async () => undefined, writeState: async (_scope, next) => { durableState = next; } }) };
        const trust = { snapshot: async () => state, assertTrustedAt: async () => undefined }; const controller = new RuntimeSyncController('user', 'device-b', trust, persistence); const authorization = { version: 1 as const, authorizationId: ids('authorization'), scope: 'user', sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceIdentityReference: 'identity-a', targetIdentityReference: 'identity-b', checkpoint, transferId: ids('transfer'), expiresAt: Date.now() + 10000, activeMemberDeviceIds: ['device-a', 'device-b'] };
        await controller.authorize(authorization); await controller.prepared(); await controller.ready(); await expect(controller.begin()).rejects.toThrow(); controller.recordPrepared('device-a'); controller.recordReady('device-a'); controller.recordPrepared('device-b'); controller.recordReady('device-b'); await controller.begin();
    });
    it('binds frames to the authenticated session identities', async () => {
        let wirePayload = '';
        const envelope = { version: 1, strategy: 'test', data: '' };
        const session = { encrypted: true, ready: true, initialize: async () => undefined, destroy: () => undefined, encrypt: async (_channel: 'signaling', bytes: ArrayBuffer) => ({ ...envelope, data: new TextDecoder().decode(bytes) }), decrypt: async (_channel: 'signaling', _value: typeof envelope) => new TextEncoder().encode(wirePayload).buffer };
        const transport = { send: async () => undefined };
        const binding = { session, sessionBinding: 'session-1', localIdentityReference: 'identity-b', peerIdentityReference: 'identity-a', peerDeviceId: 'device-a' };
        const authenticated = new AuthenticatedSyncTransport(binding, transport, 'user', 'device-b', { snapshot: setup, assertTrustedAt: async () => undefined });
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment };
        const pkg = { version: 1 as const, purpose: 'sync-chunk' as const, scope: 'user', sender: 'device-a', senderIdentity: 'identity-a', receiver: 'device-b', receiverIdentity: 'identity-b', checkpoint, streamId: ids('stream'), sequence: 1, messageId: ids('message'), payload: { ciphertext: 'opaque' } };
        wirePayload = new TextDecoder().decode(encodeSyncPackage(pkg));
        await expect(authenticated.receive(envelope, 'device-a')).resolves.toMatchObject({ senderIdentityReference: 'identity-a' });
        await expect(authenticated.receive(envelope, 'device-c')).rejects.toThrow('session rejected');
        await expect(authenticated.send({ ...pkg, sender: 'device-b', senderIdentity: 'identity-b', receiver: 'device-a', receiverIdentity: 'identity-a' })).resolves.toBeUndefined();
        await expect(authenticated.send(pkg)).rejects.toThrow('origin rejected');
    });
    it('rejects duplicate or stale state records before import', async () => {
        const state = await setup(); const checkpoint = { epoch: state.list.epoch, commitment: state.commitment };
        const record = { version: 1 as const, scope: 'user', recordId: ids('record'), kind: 'settings' as const, epoch: checkpoint.epoch, commitment: checkpoint.commitment, payload: { theme: 'paper-ink' } };
        expect(() => validateSyncRecords('user', checkpoint, [record])).not.toThrow();
        expect(() => validateSyncRecords('user', checkpoint, [record, record])).toThrow();
        expect(() => validateSyncRecords('user', { epoch: checkpoint.epoch - 1, commitment: checkpoint.commitment }, [record])).toThrow();
    });
});
