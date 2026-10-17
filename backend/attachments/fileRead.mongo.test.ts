import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { FileLedgerService, MongoFileLedgerPersistence } from './fileLedger';
import { applyMigrations } from '../db/migrations';
import type { AuthenticatedContext } from '../security/authorizationContext';
const uri = process.env.K3NCRYPT_FILE_READ_MONGO_URI;
const suite = uri ? describe : describe.skip;
suite('disposable Mongo read-only file delivery', () => {
  let client: MongoClient;
  const database = 'k3ncrypt_file_read_test_' + randomUUID().replace(/-/g, '');
  beforeAll(async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Disposable loopback Mongo required');
    client = await new MongoClient(uri).connect(); await applyMigrations(client.db(database));
  });
  afterAll(async () => { if (client) { await client.db(database).dropDatabase(); await client.close(); } });
  test.each([307 * 1024, Math.round(1.2 * 1024 * 1024)])('%i bytes: restart reads keep exact bytes without writes', async size => {
    const sender = randomUUID(), recipient = randomUUID(), room = randomUUID();
    const fp = (c: string) => 'K3 ' + Array(10).fill(c.repeat(4)).join(' ') + ' ' + c.repeat(3);
    const binding = { conversationId: room, senderParticipantId: sender, recipientParticipantId: recipient, senderIdentityReference: fp('A'), recipientIdentityReference: fp('B') };
    // Explicit fake authenticated contexts; real signed HTTP admission is covered by Chromium.
    const auth = (receive = false): AuthenticatedContext => ({ sessionId: 'fixture', requestId: randomUUID(), participantId: receive ? recipient : sender, conversationId: room, identityReference: fp(receive ? 'B' : 'A'), accountIdentityReference: sender, createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, permissions: ['attachment:create','attachment:read','attachment:write','attachment:delete'], deviceTrust: { assertTrusted: async () => {} } });
    const persistence = new MongoFileLedgerPersistence(client.db(database));
    const identities = async (_r: string, p: string) => p === sender ? fp('A') : p === recipient ? fp('B') : undefined;
    let service = new FileLedgerService(persistence, identities);
    const created = await service.create(auth(), { version: 2, binding, fileSize: size }); const id = created.context.transferId;
    const object = (bytes: number, nonce: number) => ({ nonce: Buffer.alloc(12, nonce).toString('base64url'), ciphertext: Buffer.alloc(bytes, 71).toString('base64url') });
    await service.put(auth(), id, 'manifest', object(80, 1));
    for (let i=0; i<created.context.chunkCount; i++) await service.put(auth(), id, i, object(Math.min(262144, size-i*262144)+16, i+2));
    await service.complete(auth(), id);
    service = new FileLedgerService(persistence, identities); // Fresh service, same stored ciphertext.
    const write = jest.spyOn(persistence, 'replace').mockRejectedValue(new Error('write unavailable'));
    const start = performance.now();
    expect((await service.status(auth(true), id)).state).toBe('available');
    let total=0;
    for (let i=0; i<created.context.chunkCount; i++) {
      const value = await service.chunk(auth(true), id, i);
      expect(value).toEqual(object(Math.min(262144,size-i*262144)+16,i+2));
      total += Buffer.from(value.ciphertext, 'base64url').length-16;
    }
    expect(total).toBe(size); expect(write).not.toHaveBeenCalled();
    console.log('FILE_MONGO_METRICS', JSON.stringify({bytes:size,chunks:created.context.chunkCount,readMs:Math.round(performance.now()-start),ledgerWrites:write.mock.calls.length}));
    write.mockRestore();
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const original = persistence.object.bind(persistence);
    jest.spyOn(persistence, 'object').mockImplementationOnce(async (...args) => { const value = await original(...args); started(); await gate; return value; });
    const delayed = service.chunk(auth(true), id, 0);
    await entered; await service.cancel(auth(), id); release();
    await expect(delayed).rejects.toThrow('canceled');
    await expect(service.chunk(auth(true), id, 0)).rejects.toThrow('canceled');
  });
});
