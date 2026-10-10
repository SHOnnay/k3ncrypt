import { createHash, randomUUID } from 'crypto';
import db from '../db';
import { OFFLINE_MESSAGE_COLLECTION } from '../db/const';
import { roomEnvelopeDedupeKey, storeRoomEnvelope } from './roomEnvelopeStore';
const fixture = () => ({ id: randomUUID(), channel: randomUUID(), mailbox: randomUUID(), sender: randomUUID(), timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000), envelope: { version: 2, strategy: 'opaque', data: { ciphertext: 'synthetic' } } });
it('uses the existing legacy dedupe key and arbitrates concurrent exact-envelope retries', async () => {
  const row = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => storeRoomEnvelope({ ...row, id: randomUUID() })));
  expect(new Set(results.map(result => result.id)).size).toBe(1);
  expect(await db.countOfflineMessages({ channel: row.channel, mailbox: row.mailbox })).toBe(1);
  expect(await db.findOneFromDB({ dedupeKey: roomEnvelopeDedupeKey(row.channel, row.mailbox, row.sender, row.envelope) }, OFFLINE_MESSAGE_COLLECTION)).toBeDefined();
});
it.each(['active', 'rejected'])('recognizes a pre-existing Mux %s record without altering its ID or claim', async state => {
  const row = fixture(); const claimId = randomUUID();
  const dedupeKey = createHash('sha256').update(JSON.stringify({ roomId: row.channel, mailbox: row.mailbox, sender: row.sender, envelope: row.envelope })).digest('hex');
  await db.storeOfflineMessage({ ...row, state, dedupeKey, claimId });
  const retry = await storeRoomEnvelope({ ...row, id: randomUUID() });
  expect(retry).toMatchObject({ id: row.id, claimId, state, dedupeKey });
  expect(await db.countOfflineMessages({ channel: row.channel, mailbox: row.mailbox })).toBe(state === 'active' ? 1 : 0);
});
it('does not conflate the same opaque envelope across rooms or sender identities', async () => {
  const row = fixture();
  const results = await Promise.all([storeRoomEnvelope(row), storeRoomEnvelope({ ...row, id: randomUUID(), channel: randomUUID() }), storeRoomEnvelope({ ...row, id: randomUUID(), sender: randomUUID() })]);
  expect(new Set(results.map(result => result.id)).size).toBe(3);
});
