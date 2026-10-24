import { createHash, randomBytes, randomUUID } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import db, { claimOfflineMessage, storeOfflineMessage } from './index';
import { applyMigrations } from './migrations';
import { authorizeRoutingAddress } from '../socket.io/listeners';
import { PREKEY_BUNDLE_TTL_MS } from '../api/chatHash/prekeys';
import { FILE_LIMITS } from '../../service/src/files/protocol';
const name = process.env.MONGO_DB_NAME ?? '';
const suite = process.env.MONGO_URI?.startsWith('mongodb://127.0.0.1:') && /^k3ncrypt_playwright_lifecycle_/.test(name) ? describe : describe.skip;
const DAY = 86400000;
suite('disposable real Mongo lifecycle boundaries', () => {
  let client: MongoClient; let database: Db;
  beforeAll(async () => { client = new MongoClient(process.env.MONGO_URI!); await client.connect(); database = client.db(name); await db.connectDb(); await applyMigrations(database); });
  afterAll(async () => { await database?.dropDatabase(); await db.disconnectDb(); await client?.close(); });
  it.each([0,4,5,7,8,15,30])('evaluates routing and retained mailbox eligibility after %i days', async days => {
    const now = Date.now(); const createdAt = new Date(now - days * DAY - 10);
    const expiresAt = new Date(createdAt.getTime() + PREKEY_BUNDLE_TTL_MS);
    const channel = randomUUID(); const address = randomUUID(); const proof = randomBytes(32).toString('base64url');
    await database.collection('links').insertOne({hash:channel,expired:false,deleted:false,invitationPublications:2,invitationExpiresAt:new Date(createdAt.getTime()+DAY)});
    await database.collection('prekey_bundles').insertOne({channel,address,createdAt,expiresAt,renewalProofHash:createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest('hex'),bundle:{identity:{synthetic:true}}});
    expect(await authorizeRoutingAddress(channel,address,proof)).toBe(days<7);
    expect(await authorizeRoutingAddress(channel,address,'x'.repeat(43))).toBe(false);
    const id=randomUUID();
    await storeOfflineMessage({id,dedupeKey:id,channel,mailbox:address,sender:randomUUID(),timestamp:createdAt.getTime(),expiresAt,envelope:{version:2,strategy:'vodozemac-olm-v1',data:'synthetic opaque ciphertext'}});
    const claim = await claimOfflineMessage(address,channel,new Date(Date.now()+30000),randomUUID());
    expect(Boolean(claim)).toBe(days<7);
    expect(await database.collection('links').findOne({hash:channel})).toMatchObject({expired:false,deleted:false});
    expect(FILE_LIMITS.TRANSFER_EXPIRY).toBe(DAY);
  });
  it('observes actual Mongo TTL deletion, while durable device lifecycle has no TTL', async () => {
    const address=randomUUID();
    await database.collection('prekey_bundles').insertOne({address,channel:randomUUID(),expiresAt:new Date(0)});
    // Poll only for the asynchronous server TTL monitor; no timing guess decides authorization above.
    const end=Date.now()+10000;
    while (Date.now()<end && await database.collection('prekey_bundles').countDocuments({address})) await new Promise(resolve=>setTimeout(resolve,100));
    expect(await database.collection('prekey_bundles').countDocuments({address})).toBe(0);
    expect((await database.collection('device_lifecycle').indexes()).some(index=>index.expireAfterSeconds!==undefined)).toBe(false);
  });
});
