import { randomBytes } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { hashControlCapability } from '../security/controlCapability';

const header = 'X-K3ncrypt-Control-Capability';
const key = () => randomBytes(32).toString('base64url');

const createRoom = async () => {
  const capability = key();
  const created = await request(app).post('/api/chat-link').send({ controlCapabilityHash: hashControlCapability(capability) }).expect(200);
  return { room: created.body.hash as string, capability };
};

const bundle = (keyId = 'otk-test-1') => ({
  version: 1,
  protocol: 'vodozemac-olm-v1',
  identity: { curve25519: key(), ed25519: key() },
  oneTimeKeys: [{ id: keyId, key: key() }],
});

describe('opaque Vodozemac pre-key service', () => {
  it('publishes and fetches a strict public bundle without exposing private material', async () => {
    const { room, capability } = await createRoom();
    const response = await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send(bundle()).expect(201);
    expect(response.body.address).toMatch(/^[0-9a-f-]{36}$/i);
    const fetched = await request(app).get(`/api/chat-link/${room}/prekeys/${response.body.address}`).set(header, capability).expect(200);
    expect(fetched.body).not.toHaveProperty('privateKey');
    expect(fetched.body).toHaveProperty('identity.curve25519');
  });

  it('atomically gives one one-time key to only one concurrent claimant', async () => {
    const { room, capability } = await createRoom();
    const published = await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send(bundle('otk-concurrent')).expect(201);
    const claims = await Promise.all([
      request(app).post(`/api/chat-link/${room}/prekeys/${published.body.address}/claim`).set(header, capability).send({ keyId: 'otk-concurrent' }),
      request(app).post(`/api/chat-link/${room}/prekeys/${published.body.address}/claim`).set(header, capability).send({ keyId: 'otk-concurrent' }),
    ]);
    expect(claims.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('rejects malformed and oversized bundles', async () => {
    const { room, capability } = await createRoom();
    await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send({ version: 2 }).expect(400);
    await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send({ ...bundle(), extra: 'unknown' }).expect(400);
    await request(app).post(`/api/chat-link/${room}/prekeys`).set(header, capability).send({ ...bundle(), oneTimeKeys: Array.from({ length: 101 }, (_, index) => ({ id: `otk-${index}xx`, key: key() })) }).expect(400);
  });
});
