import type { EncryptedEnvelope, CryptoSession, SecureStorage, TransportManager } from '../core/contracts';
import { AuthenticatedDeviceControlChannel, SecureStorageDeviceLifecyclePersistence } from './runtime';
import { createDeviceEntry, createDeviceList, deviceListCommitment } from './index';

const envelope: EncryptedEnvelope = { version: 1, strategy: 'test', data: {} };

class MemoryLifecycleStorage implements Partial<SecureStorage> {
  public async compareAndSwapRecords(updates: readonly import('../core/contracts').SecureRecordUpdate[]): Promise<boolean> {
    if (this.failWrites) throw new Error('simulated write failure');
    if (updates.some((item) => { const old = this.records.get(`${item.recordType}:${item.recordId}`); return old === undefined ? item.expected !== undefined : item.expected === undefined || !Buffer.from(old).equals(Buffer.from(item.expected)); })) return false;
    for (const item of updates) this.records.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
    return true;
  }
  public records = new Map<string, ArrayBuffer>();
  public failWrites = false;
  public async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`); }
  public async write(type: string, id: string, value: ArrayBuffer): Promise<void> { if (this.failWrites) throw new Error('simulated write failure'); this.records.set(`${type}:${id}`, value.slice(0)); }
}

describe('authenticated device control channel', () => {
  it('requires an encrypted ready session and preserves opaque transport', async () => {
    const sent: EncryptedEnvelope[] = [];
    const session: CryptoSession = {
      encrypted: true, ready: true, initialize: async () => undefined,
      encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
      decrypt: async (_channel, value) => new TextEncoder().encode((value.data as string)).buffer as ArrayBuffer,
      destroy: () => undefined,
    };
    const transport = { sendEnvelope: async (_channel: 'message' | 'signaling', value: EncryptedEnvelope) => { sent.push(value); return {}; } } as unknown as TransportManager;
    const channel = new AuthenticatedDeviceControlChannel(session, transport);
    await channel.send({ type: 'enrollment-rejection', payload: { version: 1, transactionNonce: 'nonce' } });
    expect(sent).toHaveLength(1);
    await expect(channel.receive(sent[0])).resolves.toEqual({ type: 'enrollment-rejection', payload: { version: 1, transactionNonce: 'nonce' } });
    await expect(channel.receive(envelope)).resolves.toBeUndefined();
  });

  it('enforces the current room control floor on send and receive and preserves unlatched compatibility', async () => {
    const ID_A = 'K3 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKK';
    const ID_B = 'K3 BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLL';
    const roomA = '11111111-1111-4111-8111-111111111111';
    const roomB = '22222222-2222-4222-8222-222222222222';
    const sent: EncryptedEnvelope[] = [];
    const session: CryptoSession = {
      encrypted: true, ready: true, initialize: async () => undefined,
      encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
      decrypt: async (_channel, value) => new TextEncoder().encode(value.data as string).buffer as ArrayBuffer,
      destroy: () => undefined,
    };
    const transport = { sendEnvelope: async (_channel: 'message' | 'signaling', value: EncryptedEnvelope) => { sent.push(value); return {}; } } as unknown as TransportManager;
    let roomFloor = 0;
    let identityCurrent = true;
    const policy = (conversationId: string, localIdentityReference: string, remoteIdentityReference: string) => ({
      conversationId, localIdentityReference, remoteIdentityReference,
      requiresRoomBoundControlV2: async () => roomFloor >= 1,
      assertCurrentIdentity: async () => { if (!identityCurrent) throw new Error('Device control identity requires review.'); },
    });
    const a = new AuthenticatedDeviceControlChannel(session, transport, policy(roomA, ID_A, ID_B));
    const b = new AuthenticatedDeviceControlChannel(session, transport, policy(roomA, ID_B, ID_A));
    const wrongRoom = new AuthenticatedDeviceControlChannel(session, transport, policy(roomB, ID_B, ID_A));
    const message = { type: 'trust-state-request' as const, payload: { request: 'freshness' } };

    // A legacy, unlatched room remains interoperable.
    await a.send(message);
    await expect(b.receive(sent[0])).resolves.toEqual(message);

    // Latching the room policy forces v2 even though this test transport has no feature advertisement.
    roomFloor = 1;
    await expect(b.receive(sent[0])).rejects.toThrow('Legacy device control');
    await a.send(message);
    expect(String(sent[1].data)).toContain('k3ncrypt-device-control-room-v2:');
    await expect(b.receive(sent[1])).resolves.toEqual(message);
    await expect(wrongRoom.receive(sent[1])).rejects.toThrow('Room-bound device control rejected');

    // A stale pin invalidates the already-created channel for both directions.
    identityCurrent = false;
    await expect(a.send(message)).rejects.toThrow('identity requires review');
    await expect(b.receive(sent[1])).rejects.toThrow('identity requires review');

    const changingIdentity = new AuthenticatedDeviceControlChannel(session, transport, {
      conversationId: roomA, localIdentityReference: ID_A, remoteIdentityReference: ID_B,
      requiresRoomBoundControlV2: async () => { identityCurrent = false; return true; },
      assertCurrentIdentity: async () => { if (!identityCurrent) throw new Error('Device control identity requires review.'); },
    });
    identityCurrent = true;
    await expect(changingIdentity.send(message)).rejects.toThrow('identity requires review');
  });

  it('rejects v2 without the matching room context and keeps truly unlatched v1 compatibility', async () => {
    const roomA = '11111111-1111-4111-8111-111111111111';
    const ID_A = 'K3 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKK';
    const ID_B = 'K3 BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLL';
    const sent: EncryptedEnvelope[] = [];
    const session: CryptoSession = {
      encrypted: true, ready: true, initialize: async () => undefined,
      encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
      decrypt: async (_channel, value) => new TextEncoder().encode(value.data as string).buffer as ArrayBuffer,
      destroy: () => undefined,
    };
    const transport = { sendEnvelope: async (_channel: 'message' | 'signaling', value: EncryptedEnvelope) => { sent.push(value); return {}; } } as unknown as TransportManager;
    const legacySender = new AuthenticatedDeviceControlChannel(session, transport);
    const legacyReceiver = new AuthenticatedDeviceControlChannel(session, transport, {
      conversationId: roomA, localIdentityReference: ID_B, remoteIdentityReference: ID_A,
      requiresRoomBoundControlV2: async () => false, assertCurrentIdentity: async () => undefined,
    });
    const message = { type: 'trust-state-request' as const, payload: {} };
    await legacySender.send(message);
    await expect(legacyReceiver.receive(sent[0])).resolves.toEqual(message);
  });

  it('keeps device-control packets within the established size limit', async () => {
    const session: CryptoSession = {
      encrypted: true, ready: true, initialize: async () => undefined,
      encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
      decrypt: async (_channel, value) => new TextEncoder().encode(value.data as string).buffer as ArrayBuffer,
      destroy: () => undefined,
    };
    const transport = { sendEnvelope: async () => ({}) } as unknown as TransportManager;
    const channel = new AuthenticatedDeviceControlChannel(session, transport, {
      conversationId: '11111111-1111-4111-8111-111111111111',
      localIdentityReference: 'K3 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKK',
      remoteIdentityReference: 'K3 BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLL',
      requiresRoomBoundControlV2: async () => true,
      assertCurrentIdentity: async () => undefined,
    });
    await expect(channel.send({ type: 'trust-state-request', payload: 'x'.repeat(65_300) })).rejects.toThrow('Invalid device control message');
  });

  it('fails closed when the session is not authenticated', async () => {
    const session: CryptoSession = { encrypted: false, ready: false, initialize: async () => undefined, encrypt: async () => envelope, decrypt: async () => new ArrayBuffer(0), destroy: () => undefined };
    const transport = { sendEnvelope: async () => ({}) } as unknown as TransportManager;
    const channel = new AuthenticatedDeviceControlChannel(session, transport);
    await expect(channel.send({ type: 'revocation', payload: {} })).rejects.toThrow('unavailable');
  });

  it('fails closed when stored commitment or list is corrupted', async () => {
    const storage = new MemoryLifecycleStorage();
    const persistence = new SecureStorageDeviceLifecyclePersistence(storage as unknown as SecureStorage);
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 0, previousCommitment: null,
      devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'vodozemac-v1', state: 'active', createdAt: 1 })] });
    await persistence.initialize('user', list);
    const record = JSON.parse(new TextDecoder().decode(storage.records.get('device-lifecycle:user')!)) as { state: { list: typeof list; commitment: string } };
    record.state.commitment = '0'.repeat(64);
    storage.records.set('device-lifecycle:user', new TextEncoder().encode(JSON.stringify(record)).buffer);
    await expect(persistence.read('user')).rejects.toThrow('commitment');
  });

  it('serializes concurrent writers and rejects stale updates', async () => {
    const storage = new MemoryLifecycleStorage();
    const persistence = new SecureStorageDeviceLifecyclePersistence(storage as unknown as SecureStorage);
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 0, previousCommitment: null,
      devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'vodozemac-v1', state: 'active', createdAt: 1 })] });
    await persistence.initialize('user', list);
    const oldRecord = storage.records.get('device-lifecycle:user')!.slice(0);
    const previous = await deviceListCommitment(list);
    const next = createDeviceList({ ...list, epoch: 1, previousCommitment: previous, devices: [...list.devices, createDeviceEntry({ deviceId: 'device-b', publicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', state: 'approved_pending_confirmation', createdAt: 2 })] });
    const nextCommitment = await deviceListCommitment(next);
    const input = { scope: 'user', expectedEpoch: 0, previousCommitment: previous, nextList: next, nextCommitment,
      authorization: { operation: 'enroll' as const, transactionNonce: 'concurrent-transaction-1', authorDeviceId: 'device-a', sequence: 1, digest: 'a'.repeat(64), expiresAt: 10 } };
    const results = await Promise.allSettled([persistence.commitEnrollment(input), persistence.commitEnrollment(input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    storage.records.set('device-lifecycle:user', oldRecord);
    await expect(persistence.read('user')).rejects.toThrow('rollback');
  });

  it('keeps the prior committed state when a write fails', async () => {
    const storage = new MemoryLifecycleStorage();
    const persistence = new SecureStorageDeviceLifecyclePersistence(storage as unknown as SecureStorage);
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 0, previousCommitment: null,
      devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'vodozemac-v1', state: 'active', createdAt: 1 })] });
    const initial = await persistence.initialize('user', list);
    storage.failWrites = true;
    const previous = initial.commitment;
    const next = createDeviceList({ ...list, epoch: 1, previousCommitment: previous, devices: [...list.devices, createDeviceEntry({ deviceId: 'device-b', publicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', state: 'approved_pending_confirmation', createdAt: 2 })] });
    await expect(persistence.commitEnrollment({ scope: 'user', expectedEpoch: 0, previousCommitment: previous, nextList: next, nextCommitment: await deviceListCommitment(next), authorization: { operation: 'enroll', transactionNonce: 'partial-write-1', authorDeviceId: 'device-a', sequence: 1, digest: 'a'.repeat(64), expiresAt: 10 } })).rejects.toThrow('simulated');
    storage.failWrites = false;
    expect((await persistence.read('user'))?.list.epoch).toBe(0);
  });
});
