import { createHash } from 'crypto';
import db from '../db';
import { OFFLINE_MESSAGE_COLLECTION } from '../db/const';
import type { WireEnvelope } from './index';

export const roomEnvelopeDedupeKey = (channel: string, mailbox: string, sender: string, envelope: WireEnvelope): string =>
  createHash('sha256').update(JSON.stringify({ channel, mailbox, sender, envelope })).digest('hex');

/** Both transports use the existing legacy key. Recognize already persisted Mux
 * keys without rewriting rows, claims, ciphertext or terminal rejection records. */
export const storeRoomEnvelope = async <T extends Record<string, unknown> & { channel: string; mailbox: string; sender: string; envelope: WireEnvelope }>(data: T): Promise<T> => {
  const priorMuxKey = createHash('sha256').update(JSON.stringify({ roomId: data.channel, mailbox: data.mailbox, sender: data.sender, envelope: data.envelope })).digest('hex');
  const prior = await db.findOneFromDB<T>({ dedupeKey: priorMuxKey }, OFFLINE_MESSAGE_COLLECTION);
  if (prior) return prior;
  // The durable unique index arbitrates concurrent callers using this one key.
  return db.storeOfflineMessage({ ...data, dedupeKey: roomEnvelopeDedupeKey(data.channel, data.mailbox, data.sender, data.envelope) });
};
