import { randomBytes } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { hashControlCapability } from '../security/controlCapability';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';

const header = 'X-K3ncrypt-Control-Capability';
const renewalHeader = 'X-K3ncrypt-Prekey-Renewal';
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


it('expires fresh invitations and atomically allows only one joining participant', async () => {
  const { LINK_COLLECTION } = await import('../db/const');
  const first = await createRoom();
  const owner = await request(app).post(`/api/chat-link/${first.room}/prekeys`).set(header, first.capability).send(bundle()).expect(201);
  const contenders = await Promise.all([1, 2].map(() => request(app).post(`/api/chat-link/${first.room}/prekeys`).set(header, first.capability).send(bundle())));
  expect(contenders.map((r) => r.status).sort()).toEqual([201, 410]);
  await request(app).get(`/api/chat-link/${first.room}/prekeys/${owner.body.address}`).set(header, first.capability).expect(200);
  const expired = await createRoom();
  await db.updateOneFromDb({ hash: expired.room }, { invitationExpiresAt: new Date(Date.now() - 1) }, LINK_COLLECTION);
  await request(app).post(`/api/chat-link/${expired.room}/prekeys`).set(header, expired.capability).send(bundle()).expect(410);
});
