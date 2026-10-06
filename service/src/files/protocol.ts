import { encodeAttachmentContext, type AttachmentAuthenticatedContext } from '../attachments/portableContext';
import type { AttachmentCiphertext } from '../attachments/portableAead';
export const FILE_LIMITS = Object.freeze({ MAX_FILE_SIZE: 8 * 1024 * 1024, MAX_CHUNK_SIZE: 256 * 1024, MAX_CHUNK_COUNT: 32, MAX_METADATA_SIZE: 2048, MAX_ACTIVE_TRANSFERS: 2, MAX_STORED_BYTES_PER_USER: 12 * 1024 * 1024, MAX_INCOMPLETE_BYTES_PER_USER: 12 * 1024 * 1024, MAX_RECORDS: 32, TRANSFER_EXPIRY: 24 * 60 * 60 * 1000 });
export const FILE_PREFIX = 'k3ncrypt-file-v2:';
export type FileBinding = Pick<AttachmentAuthenticatedContext, 'conversationId' | 'senderParticipantId' | 'recipientParticipantId' | 'senderIdentityReference' | 'recipientIdentityReference'>;
export interface FileReference { version: 2; context: AttachmentAuthenticatedContext; key: string; createdAt: number; expiresAt: number; }
export interface WireObject { nonce: string; ciphertext: string; }
export interface FileStatus { version: 2; context: AttachmentAuthenticatedContext; createdAt: number; expiresAt: number; state: 'incomplete' | 'available' | 'canceled' | 'expired'; indices: number[]; manifest?: WireObject; }
export const b64 = (value: Uint8Array): string => { let s = ''; for (const n of value) s += String.fromCharCode(n); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64 = (s: string, max: number): Uint8Array => {
    if (typeof s !== 'string' || s.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid file object.');
    const value = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
    if (value.length > max || b64(value) !== s) throw new Error('Invalid file object.'); return value;
};
export const wire = (v: AttachmentCiphertext): WireObject => ({ nonce: b64(v.nonce), ciphertext: b64(v.ciphertext) });
export const sealed = (v: WireObject, max: number): AttachmentCiphertext => { exact(v, ['nonce', 'ciphertext']); const nonce = unb64(v.nonce, 12); const ciphertext = unb64(v.ciphertext, max); if (nonce.length !== 12 || ciphertext.length < 16) throw new Error('Invalid file object.'); return { nonce, ciphertext }; };
export function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid file protocol.'); }
export const validateFileContext = (c: AttachmentAuthenticatedContext): void => { exact(c, ['transferId', 'conversationId', 'senderParticipantId', 'recipientParticipantId', 'senderIdentityReference', 'recipientIdentityReference', 'fileSize', 'chunkSize', 'chunkCount']); encodeAttachmentContext('manifest', c); if (c.fileSize > FILE_LIMITS.MAX_FILE_SIZE || c.chunkSize !== FILE_LIMITS.MAX_CHUNK_SIZE || c.chunkCount > FILE_LIMITS.MAX_CHUNK_COUNT) throw new Error('File exceeds limits.'); };
export const serializeFileReference = (r: FileReference): string => { validateFileReference(r); return FILE_PREFIX + JSON.stringify(r); };
export const validateFileReference = (r: FileReference): void => { exact(r, ['version', 'context', 'key', 'createdAt', 'expiresAt']); if (r.version !== 2) throw new Error('Unsupported file version.'); validateFileContext(r.context); if (unb64(r.key, 32).length !== 32 || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || r.expiresAt !== r.createdAt + FILE_LIMITS.TRANSFER_EXPIRY) throw new Error('Invalid file reference.'); };
export const parseFileReference = (text: string): FileReference => { if (!text.startsWith(FILE_PREFIX) || text.length > 4096) throw new Error('Unsupported file version.'); const r = JSON.parse(text.slice(FILE_PREFIX.length)) as FileReference; validateFileReference(r); return r; };
export const sameBinding = (a: FileBinding, b: FileBinding): boolean => a.conversationId === b.conversationId && a.senderParticipantId === b.senderParticipantId && a.recipientParticipantId === b.recipientParticipantId && a.senderIdentityReference === b.senderIdentityReference && a.recipientIdentityReference === b.recipientIdentityReference;
/** Encoded BSON payload plus conservative fixed per-object/record overhead; always reserved before storage. */
export const reservationBytes = (size: number, count: number): number => Math.ceil((size + count * 16) * 4 / 3) + count * 256 + 16384;
