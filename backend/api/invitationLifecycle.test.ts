import request from 'supertest';
import { randomBytes } from 'crypto';
import app from '../../app';
import db from '../db';
import { LINK_COLLECTION } from '../db/const';
import { hashControlCapability } from '../security/controlCapability';
const header = 'X-K3ncrypt-Control-Capability';
async function invitation(publications: number | undefined) {
  const capability = randomBytes(32).toString('base64url');
  const created = await request(app).post('/api/chat-link').send({ controlCapabilityHash: hashControlCapability(capability) }).expect(200);
  const room = created.body.hash as string;
  await db.updateOneFromDb({ hash: room }, { invitationPublications: publications }, LINK_COLLECTION);
  return { capability, room };
}
it('returns expiry and revocation eligibility only to the capability holder', async () => {
  const { capability, room } = await invitation(1);
  await request(app).get(`/api/chat-link/status/${room}`).set(header, randomBytes(32).toString('base64url')).expect(401);
  const status = await request(app).get(`/api/chat-link/status/${room}`).set(header, capability).expect(200);
  expect(status.body.invitation).toEqual({ expiresAt: expect.any(Number), revocable: true });
  expect(JSON.stringify(status.body)).not.toContain(capability);
});
it('revokes only an authoritatively unjoined invitation and retains its record', async () => {
  const { capability, room } = await invitation(1);
  await request(app).delete(`/api/chat-link/${room}?pendingInvitation=true`).set(header, capability).expect(200);
  expect(await db.reserveInvitationPublication(room)).toBe(false);
  expect(await db.findOneFromDB({ hash: room }, LINK_COLLECTION)).toMatchObject({ deleted: true, invitationPublications: 1 });
});
it.each([2, undefined])('refuses pending-only revocation for joined or unclassifiable records (%s)', async (publications) => {
  const { capability, room } = await invitation(publications);
  await request(app).delete(`/api/chat-link/${room}?pendingInvitation=true`).set(header, capability).expect(409);
  expect(await db.findOneFromDB({ hash: room }, LINK_COLLECTION)).toMatchObject({ deleted: false });
});
it('join admission and pending revocation have one atomic winner', async () => {
  const { capability, room } = await invitation(1);
  const [joined, result] = await Promise.all([
    db.reserveInvitationPublication(room),
    request(app).delete(`/api/chat-link/${room}?pendingInvitation=true`).set(header, capability),
  ]);
  expect(Number(joined) + Number(result.status === 200)).toBe(1);
  if (joined) expect(result.status).toBe(409);
});
