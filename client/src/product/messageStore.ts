import type { Message } from '../types';
import type { ProductSecureStorage } from './sessionStore';

interface StoredMessage extends Omit<Message, 'timestamp'> { timestamp: string; }
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TYPE = 'product-messages';
const MAX_MESSAGES = 2000;
type AtomicProductStorage = ProductSecureStorage & {
  compareAndSwapRecords?: (updates: readonly { recordType: string; recordId: string; expected: ArrayBuffer | undefined; next: ArrayBuffer }[]) => Promise<boolean>;
};

const valid = (value: unknown): value is StoredMessage => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.sender === 'string'
    && typeof item.text === 'string' && item.text.length <= 192 * 1024
    && (item.type === 'sent' || item.type === 'received') && typeof item.timestamp === 'string'
    && Number.isFinite(Date.parse(item.timestamp))
    && (item.delivery === undefined || ['pending', 'accepted', 'failed'].includes(String(item.delivery)));
};

const decodeMessages = (bytes: ArrayBuffer | undefined): Message[] => {
  if (!bytes) return [];
  const values = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
  if (!Array.isArray(values) || values.length > MAX_MESSAGES || values.some((item) => !valid(item))) throw new Error('Saved messages are invalid.');
  return values.map((item) => ({ ...(item as StoredMessage), timestamp: new Date((item as StoredMessage).timestamp) }));
};

export const readMessages = async (storage: ProductSecureStorage, roomId: string): Promise<Message[]> =>
  decodeMessages(await storage.read(TYPE, roomId));

export const writeMessages = async (storage: ProductSecureStorage, roomId: string, messages: readonly Message[]): Promise<void> => {
  const retained = messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, timestamp: message.timestamp.toISOString() }));
  await storage.write(TYPE, roomId, encoder.encode(JSON.stringify(retained)).buffer as ArrayBuffer);
};

/** Prepares an idempotent message record update for the service's atomic receive-acceptance CAS. */
export const prepareMessageRecordUpdate = async (storage: AtomicProductStorage, roomId: string, message: Message) => {
  const expected = await storage.read(TYPE, roomId);
  const existing = decodeMessages(expected);
  const next = existing.some((item) => item.id === message.id)
    ? existing.map((item) => item.id === message.id ? message : item)
    : [...existing, message];
  const retained = next.slice(-MAX_MESSAGES).map((item) => ({ ...item, timestamp: item.timestamp.toISOString() }));
  return {
    recordType: TYPE,
    recordId: roomId,
    expected,
    next: encoder.encode(JSON.stringify(retained)).buffer as ArrayBuffer,
  };
};

export const mergeAndPersistMessages = async (storage: AtomicProductStorage, roomId: string, desired: readonly Message[]): Promise<void> => {
  if (!storage.compareAndSwapRecords) throw new Error('Atomic message persistence is unavailable.');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const expected = await storage.read(TYPE, roomId);
    const current = decodeMessages(expected);
    const merged = new Map(current.map((message) => [message.id, message]));
    for (const message of desired) merged.set(message.id, message);
    const retained = [...merged.values()].slice(-MAX_MESSAGES).map((message) => ({ ...message, timestamp: message.timestamp.toISOString() }));
    const next = encoder.encode(JSON.stringify(retained)).buffer as ArrayBuffer;
    if (await storage.compareAndSwapRecords([{ recordType: TYPE, recordId: roomId, expected, next }])) return;
  }
  throw new Error('Message history changed repeatedly during persistence.');
};
