import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'crypto';
import { MongoClient } from 'mongodb';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from './durableDeviceTrust';
import { fingerprintVodozemacIdentity } from '../../service/src/identity/vodozemacIdentity';
import { applyMigrations } from '../db/migrations';
const uri = process.env.K3NCRYPT_ROUTING_MONGO_URI;
const suite = uri ? describe : describe.skip;
suite('disposable Mongo lifecycle clock boundary', () => {
  test('signed bootstrap tolerates at most five seconds ahead; expiry and signatures still fail closed', async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw Error('Disposable loopback Mongo only');
    const client = await new MongoClient(uri).connect(), database = client.db('k3ncrypt_clock_' + randomUUID().replace(/-/g, ''));
    try {
      await applyMigrations(database);
      const now = Date.now(), authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), randomBytes(32).toString('hex'), () => now);
      async function request(offset: number) {
        const pair = generateKeyPairSync('ed25519'), ed = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
        const identity = await fingerprintVodozemacIdentity({ curve25519: randomBytes(32).toString('base64url'), ed25519: ed });
        const value = { version: 1 as const, requestId: randomUUID(), deviceId: randomUUID(), deviceIdentityReference: identity, verificationKey: ed,
          fingerprint: identity, createdAt: now + offset, expiresAt: now + offset + 30000, nonce: randomBytes(24).toString('base64url') };
        return { ...value, signature: sign(null, Buffer.from(JSON.stringify(value)), pair.privateKey).toString('base64url') };
      }
      for (const offset of [0, 1, 4, 4999, 5000]) expect((await authority.bootstrap(await request(offset))).trustEpoch).toBe(1);
      await expect(authority.bootstrap(await request(5001))).rejects.toThrow();
      await expect(authority.bootstrap(await request(-30001))).rejects.toThrow();
      const tampered = await request(1); tampered.verificationKey = randomBytes(32).toString('base64url');
      await expect(authority.bootstrap(tampered)).rejects.toThrow();
    } finally { await database.dropDatabase(); await client.close(); }
  });
});
