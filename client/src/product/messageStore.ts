import { validLocalCallEvent } from './callHistory';
import { logSafeFailure } from './safeDiagnostics';
import type { Message } from '../types';
import type { ProductSecureStorage } from './sessionStore';

interface StoredMessage extends Omit<Message, 'timestamp'> { timestamp: string; }
interface SecureRecordUpdate { recordType: string; recordId: string; expected: ArrayBuffer | undefined; next: ArrayBuffer; }
interface AtomicProductMessageStorage extends ProductSecureStorage {
  compareAndSwapRecords?(updates: readonly SecureRecordUpdate[]): Promise<boolean>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TYPE = 'product-messages';
const QUARANTINE_TYPE = 'product-message-quarantine';
const MAX_MESSAGES = 2000;
const MAX_QUARANTINE_BYTES = 3 * 1024 * 1024;
const deliveryRank = (delivery: StoredMessage['delivery']): number => delivery === 'accepted' ? 2 : delivery === 'failed' ? 1 : 0;

const valid = (value: unknown): value is StoredMessage => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.sender === 'string'
    && typeof item.text === 'string' && item.text.length <= 192 * 1024
    && (item.type === 'sent' || item.type === 'received') && typeof item.timestamp === 'string'
    && Number.isFinite(Date.parse(item.timestamp))
    && (item.callEvent === undefined || item.id.startsWith('local-call:') && validLocalCallEvent(item.callEvent))
    && (item.delivery === undefined || ['pending', 'accepted', 'failed'].includes(String(item.delivery)));
};

const decode = (bytes: ArrayBuffer | undefined): StoredMessage[] => {
  if (!bytes) return [];
  const values = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
  if (!Array.isArray(values) || values.length > MAX_MESSAGES || values.some((item) => !valid(item))) throw new Error('Saved messages are invalid.');
  return values as StoredMessage[];
};

interface QuarantinedEntry { index: number; value: unknown; reason: 'invalid-message-entry'; }
interface QuarantineRecord { version: 1; entries: QuarantinedEntry[]; }

const readQuarantine = (bytes: ArrayBuffer | undefined): QuarantineRecord => {
  if (!bytes) return { version: 1, entries: [] };
  let value: unknown;
  try { value = JSON.parse(decoder.decode(new Uint8Array(bytes))); }
  catch { throw new Error('Saved message quarantine is invalid.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).version !== 1 || !Array.isArray((value as Record<string, unknown>).entries)) {
    throw new Error('Saved message quarantine is invalid.');
  }
  const entries = (value as { entries: unknown[] }).entries;
  if (entries.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !Number.isSafeInteger((item as Record<string, unknown>).index) || (item as Record<string, unknown>).reason !== 'invalid-message-entry' || !('value' in item))) {
    throw new Error('Saved message quarantine is invalid.');
  }
  return value as QuarantineRecord;
};

const parseHistoryArray = (bytes: ArrayBuffer): unknown[] => {
  let value: unknown;
  try { value = JSON.parse(decoder.decode(new Uint8Array(bytes))); }
  catch { throw new Error('Saved messages are invalid.'); }
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) throw new Error('Saved messages are invalid.');
  return value;
};

const encode = (messages: readonly StoredMessage[]): ArrayBuffer =>
  encoder.encode(JSON.stringify(messages.slice(-MAX_MESSAGES))).buffer as ArrayBuffer;

const toStored = (message: Message): StoredMessage => ({ ...message, timestamp: message.timestamp.toISOString() });

export const readMessages = async (storage: ProductSecureStorage, roomId: string): Promise<Message[]> => {
  const atomic = storage as AtomicProductMessageStorage;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const expected = await storage.read(TYPE, roomId);
    if (!expected) return [];
    const values = parseHistoryArray(expected);
    const validMessages = values.filter(valid);
    if (validMessages.length === values.length) return validMessages.map((item) => ({ ...item, timestamp: new Date(item.timestamp) }));
    if (!atomic.compareAndSwapRecords) throw new Error('Saved messages are invalid.');

    const quarantined = values.flatMap((value, index) => valid(value) ? [] : [{ index, value, reason: 'invalid-message-entry' as const }]);
    const quarantineExpected = await storage.read(QUARANTINE_TYPE, roomId);
    const priorQuarantine = readQuarantine(quarantineExpected);
    const quarantineBytes = encoder.encode(JSON.stringify({ version: 1, entries: [...priorQuarantine.entries, ...quarantined] } satisfies QuarantineRecord));
    if (quarantineBytes.byteLength > MAX_QUARANTINE_BYTES) throw new Error('Saved messages are invalid.');
    const next = encode(validMessages);
    const updated = await atomic.compareAndSwapRecords([
      { recordType: QUARANTINE_TYPE, recordId: roomId, expected: quarantineExpected, next: quarantineBytes.buffer.slice(quarantineBytes.byteOffset, quarantineBytes.byteOffset + quarantineBytes.byteLength) as ArrayBuffer },
      { recordType: TYPE, recordId: roomId, expected, next },
    ]);
    if (updated) {
      logSafeFailure('conversation_open_failed', 'MESSAGE_HISTORY_ENTRY_QUARANTINED');
      return validMessages.map((item) => ({ ...item, timestamp: new Date(item.timestamp) }));
    }
  }
  throw new Error('Message history changed too often to restore safely.');
};

/** Prepare history bytes for the same secure-storage transaction as the Olm ratchet and replay identities. */
export const prepareMessageAcceptance = async (
  storage: ProductSecureStorage,
  roomId: string,
  message: Message,
): Promise<SecureRecordUpdate> => {
  const expected = await storage.read(TYPE, roomId);
  const current = decode(expected);
  const stored = toStored(message);
  const existing = current.find((item) => item.id === stored.id);
  if (existing) {
    if (existing.sender !== stored.sender || existing.text !== stored.text || existing.type !== stored.type) {
      throw new Error('Accepted message identity conflicts with saved history.');
    }
    return { recordType: TYPE, recordId: roomId, expected, next: expected?.slice(0) ?? encode(current) };
  }
  return { recordType: TYPE, recordId: roomId, expected, next: encode([...current, stored]) };
};

/** Merge React's history projection without letting an older render erase a committed inbound message. */
export const writeMessages = async (storage: ProductSecureStorage, roomId: string, messages: readonly Message[]): Promise<void> => {
  const atomic = storage as AtomicProductMessageStorage;
  const incoming = messages.map(toStored);
  if (!atomic.compareAndSwapRecords) {
    const current = decode(await storage.read(TYPE, roomId));
    await storage.write(TYPE, roomId, encode(mergeHistory(current, incoming)));
    return;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const expected = await storage.read(TYPE, roomId);
    const next = encode(mergeHistory(decode(expected), incoming));
    if (await atomic.compareAndSwapRecords([{ recordType: TYPE, recordId: roomId, expected, next }])) return;
  }
  throw new Error('Message history changed too often to persist safely.');
};

const mergeHistory = (current: readonly StoredMessage[], incoming: readonly StoredMessage[]): StoredMessage[] => {
  const result = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = result.get(message.id);
    if (!existing) { result.set(message.id, message); continue; }
    if (deliveryRank(message.delivery) > deliveryRank(existing.delivery)) result.set(message.id, { ...existing, delivery: message.delivery });
  }
  return [...result.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).slice(-MAX_MESSAGES);
};
