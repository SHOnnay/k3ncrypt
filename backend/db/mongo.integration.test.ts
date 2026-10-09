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

  it('rehearses migration failure and resume without dropping queued or terminal mailbox records', async () => {
    const name = `${configuredDbName}_migration_${randomUUID().split('-').join('').slice(0, 8)}`;
    auxiliaryDatabases.push(name);
    const legacyDb = client.db(name);
    const room = randomUUID(); const mailbox = randomUUID(); const expiresAt = new Date(Date.now() + 60_000);
    const collection = legacyDb.collection('offline_messages');
    await collection.createIndex({ channel: 1, mailbox: 1, slot: 1 }, { unique: true });
    const queued = { id: randomUUID(), dedupeKey: `queued-${randomUUID()}`, channel: room, mailbox, sender: randomUUID(), slot: 5,
      envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'preserve-this-ciphertext' } }, timestamp: Date.now(), expiresAt };
    const terminal = { id: randomUUID(), dedupeKey: `terminal-${randomUUID()}`, channel: room, mailbox, sender: randomUUID(),
      state: 'rejected', terminalReason: 'unsupported-message', terminalAt: new Date(), expiresAt };
    await collection.insertOne(queued);
    await collection.insertOne(terminal);

    const originalCollection = legacyDb.collection.bind(legacyDb);
    const failureDb = {
      collection: (name: string) => {
        const target = originalCollection(name);
        if (name !== 'offline_messages') return target;
        return new Proxy(target, {
          get(collectionTarget, property, receiver) {
            if (property === 'createIndex') return async (keys: Record<string, unknown>, options?: Record<string, unknown>) => {
              if (keys.channel === 1 && keys.mailbox === 1 && keys.slot === 1 && options?.partialFilterExpression) {
                throw new Error('injected partial-index creation failure');
              }
              return collectionTarget.createIndex(keys as never, options as never);
            };
            const value = Reflect.get(collectionTarget, property, receiver);
            return typeof value === 'function' ? value.bind(collectionTarget) : value;
          },
        });
      },
    } as unknown as Db;

    await expect(applyMigrations(failureDb)).rejects.toThrow('injected partial-index creation failure');
    expect(await collection.findOne({ id: queued.id })).toMatchObject({ ...queued, state: 'active' });
    expect(await collection.findOne({ id: terminal.id })).toMatchObject(terminal);

    // A failed DDL step leaves records intact but requires migration completion
    // before rollout. Re-running the supported idempotent migration recovers.
    await applyMigrations(legacyDb);
    await applyMigrations(legacyDb);
    expect(await collection.findOne({ id: queued.id })).toMatchObject({ ...queued, state: 'active' });
    expect(await collection.findOne({ id: terminal.id })).toMatchObject(terminal);
    const slotIndex = (await collection.listIndexes().toArray()).find((index) => index.name === 'channel_1_mailbox_1_slot_1');
    expect(slotIndex?.partialFilterExpression).toEqual({ state: 'active' });
    await expect(collection.insertOne({ id: randomUUID(), dedupeKey: `terminal-slot-${randomUUID()}`, channel: room, mailbox,
      sender: randomUUID(), state: 'rejected', terminalReason: 'unsupported-message', terminalAt: new Date(), slot: 5, expiresAt })).resolves.toBeDefined();
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

  it('claims one deterministic FIFO head under competing Mongo workers', async () => {
    const room = randomUUID(); const mailbox = randomUUID(); const now = Date.now();
    const first = { ...message(room, mailbox), timestamp: now };
    const second = { ...message(room, mailbox), timestamp: now + 1 };
    await storeOfflineMessage(second); await storeOfflineMessage(first);

    const [left, right] = await Promise.all([
      claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID()),
      claimOfflineMessage<typeof second & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID()),
    ]);
    const owner = left ?? right;
    expect(owner?.id).toBe(first.id);
    expect(Number(!!left) + Number(!!right)).toBe(1);
    expect(await claimOfflineMessage(mailbox, room, new Date(Date.now() + 30_000), randomUUID())).toBeUndefined();
    expect(await ackOfflineMessage(first.id, mailbox, room, owner!.claimId)).toBe(true);
    const next = await claimOfflineMessage<typeof second & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
    expect(next?.id).toBe(second.id);
    expect(await ackOfflineMessage(second.id, mailbox, room, next!.claimId)).toBe(true);

    const tiedRoom = randomUUID(); const tiedMailbox = randomUUID(); const tiedAt = Date.now();
    const tiedFirst = { ...message(tiedRoom, tiedMailbox), timestamp: tiedAt };
    const tiedSecond = { ...message(tiedRoom, tiedMailbox), timestamp: tiedAt };
    await storeOfflineMessage(tiedFirst); await storeOfflineMessage(tiedSecond);
    const tiedHead = await claimOfflineMessage<typeof tiedFirst & { claimId: string }>(tiedMailbox, tiedRoom, new Date(Date.now() + 30_000), randomUUID());
    expect(tiedHead?.id).toBe(tiedFirst.id);
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
    const firstClaim = await claimOfflineMessage<typeof item & { claimId: string }>(item.mailbox, item.channel, new Date(Date.now() + 50), randomUUID());
    expect(firstClaim?.id).toBe(item.id);
    expect(await countOfflineMessages({ mailbox: item.mailbox, channel: item.channel })).toBe(1);
    expect(await claimOfflineMessage(item.mailbox, item.channel, new Date(Date.now() + 30_000), randomUUID())).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 60));
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
