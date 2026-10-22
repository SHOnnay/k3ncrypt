import { randomBytes } from 'crypto';
import request from 'supertest';
import app from '../../app';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';
import { hashControlCapability } from '../security/controlCapability';
import { PREKEY_BUNDLE_TTL_MS } from './chatHash/prekeys';
const header = 'X-K3ncrypt-Control-Capability';
const renewalHeader = 'X-K3ncrypt-Prekey-Renewal';
const key = () => randomBytes(32).toString('base64url');
const createRoom = async () => {
  const capability = key();
  const result = await request(app).post('/api/chat-link').send({ controlCapabilityHash: hashControlCapability(capability) }).expect(200);
  return { room: result.body.hash as string, capability };
};
const bundle = (id: string) => ({ version: 1, protocol: 'vodozemac-olm-v1',
  identity: { curve25519: key(), ed25519: key() }, oneTimeKeys: [{ id, key: key() }] });
// A separate test-runtime module gives this disposable fixture its own limiter.
// Production rate limiting is neither mocked nor disabled.


it('does not recreate seven-day-expired prekey authority even with the original room capability and renewal proof', async () => {
  const { room, capability } = await createRoom();
  const original = bundle('otk-expired-owner');
  const published = await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send(original).expect(201);
  await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send(bundle('otk-other-peer')).expect(201);
  await request(app).get(`/api/chat-link/${room}/prekeys/${published.body.address}`).set(header, capability).expect(200);
  const record = await db.findOneFromDB<{ createdAt: Date; expiresAt: Date }>({ channel: room, address: published.body.address }, PREKEY_COLLECTION);
  expect(PREKEY_BUNDLE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  // Deterministic persisted age, not a sleep or a timing race. The room remains active.
  record.createdAt = new Date(Date.now() - PREKEY_BUNDLE_TTL_MS - 1000);
  record.expiresAt = new Date(record.createdAt.getTime() + PREKEY_BUNDLE_TTL_MS);
  expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(PREKEY_BUNDLE_TTL_MS);
  await request(app).get(`/api/chat-link/status/${room}`).set(header, capability).expect(200);
  await request(app).get(`/api/chat-link/${room}/prekeys/${published.body.address}`).set(header, capability).expect(404);
  await request(app).post(`/api/chat-link/${room}/prekeys/${published.body.address}/renew`).set(header, capability).set(renewalHeader, published.body.renewalProof).send(original).expect(403);
  expect(await db.findOneFromDB({ channel: room, address: published.body.address }, PREKEY_COLLECTION)).toBeFalsy();
});
