import { MongoClient } from 'mongodb';
import db from './index';

const suite = process.env.MONGO_URI ? describe : describe.skip;

suite('MongoDB Phase 3H integration', () => {
  let client: MongoClient;

  beforeAll(async () => {
    await db.connectDb();
    client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
  });

  afterAll(async () => { await client?.close(); });

  it('creates the required TTL, uniqueness, and mailbox-claim indexes idempotently', async () => {
    const database = client.db(process.env.MONGO_DB_NAME);
    const prekeys = await database.collection('prekey_bundles').listIndexes().toArray();
    const offline = await database.collection('offline_messages').listIndexes().toArray();
    expect(prekeys.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(prekeys.some((index) => index.unique && index.key?.channel === 1 && index.key?.address === 1)).toBe(true);
    expect(offline.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(offline.some((index) => index.unique && index.key?.dedupeKey === 1)).toBe(true);
    expect(offline.some((index) => index.key?.mailbox === 1 && index.key?.claimedUntil === 1)).toBe(true);
    await db.connectDb();
  });
});
