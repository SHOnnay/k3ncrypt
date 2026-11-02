import { randomUUID } from 'crypto';
import request from 'supertest';
import { MongoClient, type Db } from 'mongodb';
import { STORAGE_CAPS } from './storageCaps';

// P1-2 on a real, disposable loopback Mongo (scripts/test-mongo.sh). Never Atlas.
const uri = process.env.K3NCRYPT_RETENTION_MONGO_URI;
const suite = uri?.startsWith('mongodb://127.0.0.1:') ? describe : describe.skip;

suite('anonymous storage caps on real Mongo', () => {
  const name = `k3ncrypt_caps_${randomUUID().replace(/-/g, '')}`;
  let raw: MongoClient; let database: Db;
  let db: typeof import('./index').default;
  beforeAll(async () => {
    process.env.MONGO_URI = uri; process.env.MONGO_DB_NAME = name; process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = 'c'.repeat(48);
    jest.resetModules();
    db = (await import('./index')).default;
    await db.connectDb();
    raw = new MongoClient(uri!); await raw.connect(); database = raw.db(name);
  });
  afterAll(async () => { await database?.dropDatabase(); await raw?.close(); await db?.disconnectDb(); });
  const envelope = (sender: string, senderDevice?: string) => ({ id: randomUUID(), dedupeKey: randomUUID(), channel: randomUUID(), mailbox: randomUUID(), sender,
    envelope: { version: 2, strategy: 'opaque', data: {} }, timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000), ...(senderDevice ? { senderDevice } : {}) });

  it('caps waiting envelopes per sending device across rooms', async () => {
    const device = randomUUID();
    await database.collection('offline_messages').insertMany(Array.from({ length: STORAGE_CAPS.offlinePerDevice }, () => ({ ...envelope('s', device), state: 'active', slot: 0 })));
    await expect(db.storeOfflineMessage(envelope('s', device))).rejects.toMatchObject({ cap: 'offline-device', message: 'STORAGE_FULL' });
    await expect(db.storeOfflineMessage(envelope('s', randomUUID()))).resolves.toBeDefined(); // another device is unaffected
    await database.collection('offline_messages').deleteMany({});
  });

  it('caps waiting envelopes globally', async () => {
    await database.collection('offline_messages').insertMany(Array.from({ length: STORAGE_CAPS.offlineGlobal }, () => ({ ...envelope('s'), state: 'active', slot: 0 })));
    await expect(db.storeOfflineMessage(envelope('s', randomUUID()))).rejects.toMatchObject({ cap: 'offline-global' });
    await database.collection('offline_messages').deleteMany({});
  });

  it('refuses new rooms and new devices at their global caps with 503', async () => {
    const { default: app } = await import('../../app');
    await database.collection('links').insertMany(Array.from({ length: STORAGE_CAPS.rooms }, () => ({ hash: randomUUID() })));
    const room = await request(app).post('/api/chat-link').send({ controlCapabilityHash: 'a'.repeat(64) });
    expect(room.status).toBe(503); expect(room.body.error).toBe('K3NCRYPT is full right now. Try again later.');
    await database.collection('device_lifecycle').insertMany(Array.from({ length: STORAGE_CAPS.devices }, () => ({ accountIdentityReference: randomUUID(), deviceId: randomUUID() })));
    const device = await request(app).post('/api/device-trust/bootstrap').send({});
    expect(device.status).toBe(503);
  }, 60_000);
});
