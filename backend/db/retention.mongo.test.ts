import { randomUUID } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import { applyMigrations } from './migrations';
import { DAY_MS, MAX_UNCLAIMED_MS, RETENTION_COLLECTIONS } from './retention';
import { MongoFileLedgerPersistence } from '../attachments/fileLedger';
import { MongoAttachmentPersistence } from '../attachments/mongoAttachmentPersistence';

// P0-2 on a real, disposable loopback Mongo started with --setParameter ttlMonitorSleepSecs=1.
// Proves the TTL indexes exist, old rows are backfilled, new rows carry purgeAt, and Mongo
// itself deletes due rows. Never point this at Atlas.
const uri = process.env.K3NCRYPT_RETENTION_MONGO_URI;
const suite = uri?.startsWith('mongodb://127.0.0.1:') ? describe : describe.skip;

suite('transfer metadata retention on real Mongo', () => {
  let client: MongoClient; let db: Db; const name = `k3ncrypt_retention_${randomUUID().replace(/-/g, '')}`;
  beforeAll(async () => { client = new MongoClient(uri!); await client.connect(); db = client.db(name); });
  afterAll(async () => { await db?.dropDatabase(); await client?.close(); });

  it('backfills purgeAt on pre-retention rows, adds TTL indexes, and Mongo deletes what is due', async () => {
    const now = Date.now(); const past = now - 30 * DAY_MS;
    await db.collection('file_ledgers_v2').insertMany([
      { _id: 'empty-account', revision: 1, transfers: [] } as never,
      { _id: 'old-account', revision: 1, transfers: [{ context: { transferId: randomUUID() }, expiresAt: past }] } as never,
      { _id: 'live-account', revision: 1, transfers: [{ context: { transferId: randomUUID() }, expiresAt: now + DAY_MS }] } as never,
    ]);
    await db.collection('attachment_metadata').insertMany([
      { id: 'old', createdAt: past, expiresAt: past + DAY_MS, status: 'available' },
      { id: 'live', createdAt: now, expiresAt: now + DAY_MS, status: 'available' },
    ]);
    await db.collection('attachment_chunks').insertMany([{ attachmentId: 'old', index: 0, storedAt: past }, { attachmentId: 'live', index: 0, storedAt: now }]);
    await db.collection('attachment_access').insertOne({ attachmentId: 'any', conversationId: 'c' });

    await applyMigrations(db);
    await applyMigrations(db); // idempotent

    for (const collection of RETENTION_COLLECTIONS) {
      const index = (await db.collection(collection).indexes()).find((item) => item.name === 'purgeAt_1');
      expect(index?.expireAfterSeconds).toBe(0);
      expect(await db.collection(collection).countDocuments({ purgeAt: { $exists: false } })).toBe(0);
    }
    const live = await db.collection('file_ledgers_v2').findOne({ _id: 'live-account' as never });
    expect((live!.purgeAt as Date).getTime()).toBe(now + 2 * DAY_MS);
    const access = await db.collection('attachment_access').findOne({ attachmentId: 'any' });
    expect((access!.purgeAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + MAX_UNCLAIMED_MS);

    // Mongo's own TTL monitor must remove everything already due, and nothing that is not.
    const deadline = Date.now() + 70_000;
    const due = async () => (await db.collection('file_ledgers_v2').countDocuments({ _id: { $in: ['empty-account', 'old-account'] } as never }))
      + (await db.collection('attachment_metadata').countDocuments({ id: 'old' }))
      + (await db.collection('attachment_chunks').countDocuments({ attachmentId: 'old' }));
    while (await due() > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await due()).toBe(0);
    expect(await db.collection('file_ledgers_v2').countDocuments({ _id: 'live-account' as never })).toBe(1);
    expect(await db.collection('attachment_metadata').countDocuments({ id: 'live' })).toBe(1);
    expect(await db.collection('attachment_chunks').countDocuments({ attachmentId: 'live' })).toBe(1);
  }, 90_000);

  it('new writes carry purgeAt and it never leaks back out of persistence', async () => {
    const ledger = new MongoFileLedgerPersistence(db);
    const now = Date.now();
    await ledger.replace(undefined, { _id: 'writer-account', revision: 1, transfers: [{ context: { transferId: randomUUID() }, expiresAt: now + DAY_MS } as never] });
    const stored = await db.collection('file_ledgers_v2').findOne({ _id: 'writer-account' as never });
    expect((stored!.purgeAt as Date).getTime()).toBeGreaterThanOrEqual(now + 2 * DAY_MS);
    expect((stored!.purgeAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + MAX_UNCLAIMED_MS);

    const v1 = new MongoAttachmentPersistence(db);
    const record = { id: 'writer-v1', encryptedMetadata: { nonce: new Uint8Array(12), ciphertext: new Uint8Array(16) }, chunkCount: 1, size: 1, createdAt: now, expiresAt: now + 30 * DAY_MS, status: 'available', accessHash: 'h' };
    await v1.metadata.insert(record as never);
    const doc = await db.collection('attachment_metadata').findOne({ id: 'writer-v1' });
    expect((doc!.purgeAt as Date).getTime()).toBe(now + MAX_UNCLAIMED_MS);
    expect(Object.keys((await v1.metadata.find('writer-v1')) ?? {})).not.toContain('purgeAt');
    await v1.chunks.insert({ attachmentId: 'writer-v1', index: 0, total: 1, nonce: new Uint8Array(12), ciphertext: new Uint8Array(16) } as never);
    const chunk = await db.collection('attachment_chunks').findOne({ attachmentId: 'writer-v1' });
    expect((chunk!.purgeAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + MAX_UNCLAIMED_MS);
  });
});
