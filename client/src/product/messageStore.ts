import type { Message } from '../types';
import type { ProductSecureStorage } from './sessionStore';

interface StoredMessage extends Omit<Message, 'timestamp'> { timestamp: string; }
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TYPE = 'product-messages';
const MAX_MESSAGES = 2000;

const valid = (value: unknown): value is StoredMessage => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.sender === 'string'
    && typeof item.text === 'string' && item.text.length <= 192 * 1024
    && (item.type === 'sent' || item.type === 'received') && typeof item.timestamp === 'string'
    && Number.isFinite(Date.parse(item.timestamp))
    && (item.delivery === undefined || ['pending', 'accepted', 'failed'].includes(String(item.delivery)));
};

export const readMessages = async (storage: ProductSecureStorage, roomId: string): Promise<Message[]> => {
  const bytes = await storage.read(TYPE, roomId);
  if (!bytes) return [];
  const values = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
  if (!Array.isArray(values) || values.length > MAX_MESSAGES || values.some((item) => !valid(item))) throw new Error('Saved messages are invalid.');
  return values.map((item) => ({ ...(item as StoredMessage), timestamp: new Date((item as StoredMessage).timestamp) }));
};

export const writeMessages = async (storage: ProductSecureStorage, roomId: string, messages: readonly Message[]): Promise<void> => {
  const retained = messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, timestamp: message.timestamp.toISOString() }));
  await storage.write(TYPE, roomId, encoder.encode(JSON.stringify(retained)).buffer as ArrayBuffer);
};
