import { randomUUID } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import db, { ackOfflineMessage, claimOfflineMessage, countOfflineMessages, rejectOfflineMessage, storeOfflineMessage } from './index';
import { applyMigrations } from './migrations';

const configuredDbName = process.env.MONGO_DB_NAME ?? '';
// These integration tests may drop only explicitly disposable Playwright databases.
const suite = process.env.MONGO_URI && /^k3ncrypt_playwright_[a-zA-Z0-9_-]+$/.test(configuredDbName) ? describe : describe.skip;

suite('MongoDB mailbox terminal-rejection integration', () => {
  let client: MongoClient;
  let database: Db;
  const auxiliaryDatabases: string[] = [];
  const message = (room = randomUUID(), mailbox = randomUUID()) => ({
    id: randomUUID(), dedupeKey: `mongo-dedupe-${randomUUID()}`, channel: room, mailbox, sender: randomUUID(),
    envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'mongo-test-ciphertext' } },
    timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000),
  });

  beforeAll(async () => {
    client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    database = client.db(configuredDbName);
    await database.dropDatabase();
    await db.connectDb();
    await applyMigrations(database);
  });

  afterAll(async () => {
    if (database) await database.dropDatabase();
    for (const name of auxiliaryDatabases) await client.db(name).dropDatabase();
    await db.disconnectDb();
    await client?.close();
  });

  it('migrates a fresh database with required TTL, uniqueness, and active-slot indexes', async () => {
    const prekeys = await database.collection('prekey_bundles').listIndexes().toArray();
    const offline = await database.collection('offline_messages').listIndexes().toArray();
    expect(prekeys.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(prekeys.some((index) => index.unique && index.key?.channel === 1 && index.key?.address === 1)).toBe(true);
    expect(offline.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(offline.some((index) => index.unique && index.key?.dedupeKey === 1)).toBe(true);
    expect(offline.some((index) => index.key?.mailbox === 1 && index.key?.claimedUntil === 1)).toBe(true);
    expect(offline.find((index) => index.name === 'channel_1_mailbox_1_slot_1')?.partialFilterExpression).toEqual({ state: 'active' });
    await applyMigrations(database);
    expect((await database.collection('offline_messages').listIndexes().toArray()).some((index) => index.name === 'channel_1_mailbox_1_slot_1')).toBe(true);
  });

  it('backfills pre-change active rows and replaces the unconditional slot index without hiding them', async () => {
    const name = `${configuredDbName}_legacy_${randomUUID().split('-').join('').slice(0, 8)}`;
    auxiliaryDatabases.push(name);
    const legacyDb = client.db(name);
    const room = randomUUID(); const mailbox = randomUUID(); const rowId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const collection = legacyDb.collection('offline_messages');
    await collection.createIndex({ channel: 1, mailbox: 1, slot: 1 }, { unique: true });
    await collection.insertOne({ id: rowId, dedupeKey: `legacy-${randomUUID()}`, channel: room, mailbox, sender: randomUUID(), slot: 4,
      envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'legacy-ciphertext' } }, timestamp: Date.now(), expiresAt });

    await applyMigrations(legacyDb);

    const migrated = await collection.findOne({ id: rowId });
    expect(migrated).toMatchObject({ state: 'active', id: rowId });
    expect(migrated?.envelope).toBeDefined();
    const indexes = await collection.listIndexes().toArray();
    expect(indexes.find((index) => index.name === 'channel_1_mailbox_1_slot_1')?.partialFilterExpression).toEqual({ state: 'active' });
    const legacyClaim = await collection.findOneAndUpdate(
      { mailbox, channel: room, expiresAt: { $gt: new Date() }, $or: [{ claimedUntil: { $exists: false } }, { claimedUntil: { $lte: new Date() } }] },
      { $set: { claimedUntil: new Date(Date.now() + 30_000) } }, { returnDocument: 'after' },
    );
    expect(legacyClaim).toMatchObject({ id: rowId, state: 'active' });
  });

  it('conditionally removes an accepted message only for the matching claim', async () => {
    const item = message();
    await storeOfflineMessage(item);
    const claimId = randomUUID();
    expect(await claimOfflineMessage<typeof item & { claimId: string }>(item.mailbox, item.channel, new Date(Date.now() + 30_000), claimId)).toMatchObject({ id: item.id, claimId });
    expect(await ackOfflineMessage(item.id, item.mailbox, item.channel, randomUUID())).toBe(false);
    expect(await ackOfflineMessage(item.id, item.mailbox, item.channel, claimId)).toBe(true);
    expect(await database.collection('offline_messages').findOne({ id: item.id })).toBeNull();
  });

  it('terminally rejects the first claimed poison row and continues to the other valid row', async () => {
    const room = randomUUID(); const mailbox = randomUUID();
    const first = message(room, mailbox); const second = message(room, mailbox);
    await storeOfflineMessage(first); await storeOfflineMessage(second);
    const firstClaim = await claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
    expect(firstClaim).toBeDefined();
    const poisonId = firstClaim!.id;
    const poisonClaim = firstClaim!.claimId;
    const validId = poisonId === first.id ? second.id : first.id;

    expect(await rejectOfflineMessage(poisonId, mailbox, room, poisonClaim, 'authenticated-invalid')).toBe('rejected');
    expect(await countOfflineMessages({ mailbox, channel: room })).toBe(1);
    const next = await claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
    expect(next?.id).toBe(validId);
    expect(await ackOfflineMessage(next!.id, mailbox, room, next!.claimId)).toBe(true);

    const terminal = await database.collection('offline_messages').findOne({ id: poisonId });
    expect(terminal).toMatchObject({ state: 'rejected', terminalClaimId: poisonClaim, expiresAt: expect.any(Date), claimedUntil: expect.any(Date) });
    expect(terminal?.claimedUntil?.getTime()).toBe(terminal?.expiresAt?.getTime());
    expect(terminal).not.toHaveProperty('envelope');
    expect(terminal).not.toHaveProperty('claimId');
    expect(terminal).not.toHaveProperty('slot');

    // A previous server version does not filter `state`; its old lease query
    // must still skip this tombstone until its TTL expires.
    const previousRelayClaim = await database.collection('offline_messages').findOneAndUpdate(
      { mailbox, channel: room, expiresAt: { $gt: new Date() }, $or: [{ claimedUntil: { $exists: false } }, { claimedUntil: { $lte: new Date() } }] },
      { $set: { claimedUntil: new Date(Date.now() + 30_000) } }, { returnDocument: 'after' },
    );
    expect(previousRelayClaim).toBeNull();

    const poison = poisonId === first.id ? first : second;
    const duplicate = await storeOfflineMessage({ ...poison, id: randomUUID() });
    expect(duplicate).toMatchObject({ id: poisonId, state: 'rejected' });
    expect(duplicate).not.toHaveProperty('envelope');
    expect(await countOfflineMessages({ mailbox, channel: room })).toBe(0);
  });

  it('keeps a row active after transient failure and permits retry after lease expiry', async () => {
    const item = message();
    await storeOfflineMessage(item);
    const firstClaim = await claimOfflineMessage<typeof item & { claimId: string }>(item.mailbox, item.channel, new Date(Date.now() - 1), randomUUID());
    expect(firstClaim?.id).toBe(item.id);
    expect(await countOfflineMessages({ mailbox: item.mailbox, channel: item.channel })).toBe(1);
    const retryClaim = await claimOfflineMessage<typeof item & { claimId: string; state: string }>(item.mailbox, item.channel, new Date(Date.now() + 30_000), randomUUID());
    expect(retryClaim?.id).toBe(item.id);
    expect(retryClaim?.state).toBe('active');
    expect(await ackOfflineMessage(item.id, item.mailbox, item.channel, retryClaim!.claimId)).toBe(true);
  });

  it('rejects stale claim generations and makes a duplicate current rejection idempotent', async () => {
    const item = message();
    await storeOfflineMessage(item);
    const staleId = randomUUID(); const currentId = randomUUID();
    await claimOfflineMessage(item.mailbox, item.channel, new Date(Date.now() - 1), staleId);
    const current = await claimOfflineMessage<typeof item & { claimId: string }>(item.mailbox, item.channel, new Date(Date.now() + 30_000), currentId);
    expect(current?.claimId).toBe(currentId);
    expect(await ackOfflineMessage(item.id, item.mailbox, item.channel)).toBe(false);
    expect(await ackOfflineMessage(item.id, item.mailbox, item.channel, '')).toBe(false);
    expect(await rejectOfflineMessage(item.id, item.mailbox, item.channel, staleId, 'unsupported-message')).toBe('stale');
    expect(await database.collection('offline_messages').findOne({ id: item.id })).toMatchObject({ state: 'active', claimId: currentId });
    expect(await rejectOfflineMessage(item.id, item.mailbox, item.channel, currentId, 'unsupported-message')).toBe('rejected');
    expect(await rejectOfflineMessage(item.id, item.mailbox, item.channel, currentId, 'unsupported-message')).toBe('duplicate');
  });

  it('frees all 64 active slots after terminal decisions and preserves TTL accounting', async () => {
    const room = randomUUID(); const mailbox = randomUUID();
    const items = Array.from({ length: 64 }, () => message(room, mailbox));
    for (const item of items) await storeOfflineMessage(item);
    expect(await countOfflineMessages({ mailbox, channel: room })).toBe(64);
    for (const item of items) {
      const claim = await claimOfflineMessage<typeof item & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
      expect(claim).toBeDefined();
      expect(await rejectOfflineMessage(claim!.id, mailbox, room, claim!.claimId, 'unsupported-message')).toBe('rejected');
    }
    expect(await countOfflineMessages({ mailbox, channel: room })).toBe(0);
    const legitimate = message(room, mailbox);
    await expect(storeOfflineMessage(legitimate)).resolves.toMatchObject({ id: legitimate.id, state: 'active' });
    const expiryIndex = (await database.collection('offline_messages').listIndexes().toArray()).find((index) => index.key?.expiresAt === 1);
    expect(expiryIndex?.expireAfterSeconds).toBe(0);
    const tombstone = await database.collection('offline_messages').findOne({ id: items[0].id });
    expect(tombstone?.expiresAt).toEqual(items[0].expiresAt);
    expect(tombstone?.claimedUntil).toEqual(items[0].expiresAt);
  });
});
