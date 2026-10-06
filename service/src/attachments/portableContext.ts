export type AttachmentObjectType = 'manifest' | 'chunk';
/** Stable identities are the exact pinned public fingerprint strings, not display labels or Olm session IDs. */
export interface AttachmentAuthenticatedContext {
    transferId: string;
    conversationId: string;
    senderParticipantId: string;
    recipientParticipantId: string;
    senderIdentityReference: string;
    recipientIdentityReference: string;
    fileSize: number;
    chunkSize: number;
    chunkCount: number;
    chunkIndex?: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_REFERENCE = /^K3 (?:[A-Z0-9_-]{4} ){10}[A-Z0-9_-]{3}$/;
const encoder = new TextEncoder();
const validString = (value: string, max: number): Uint8Array => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid attachment context.');
    const bytes = encoder.encode(value);
    if (bytes.length > max * 4 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== value) throw new Error('Invalid attachment context.');
    return bytes;
};
const uuidBytes = (value: string): Uint8Array => {
    if (!UUID.test(value)) throw new Error('Invalid attachment context.');
    return new Uint8Array(value.replace(/-/g, '').match(/.{2}/g)!.map((byte: string) => Number.parseInt(byte, 16)));
};
const unsigned = (value: number, bytes: number): Uint8Array => {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (8 * bytes)) throw new Error('Invalid attachment context.');
    const out = new Uint8Array(bytes);
    let remaining = value;
    for (let i = bytes - 1; i >= 0; i -= 1) { out[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
    return out;
};
const concat = (...values: Uint8Array[]): Uint8Array => {
    const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
    let offset = 0;
    for (const value of values) { result.set(value, offset); offset += value.length; }
    return result;
};
/**
 * Wire contract k3ncrypt/attachment-aad/v2:
 * ASCII domain+NUL, version u8, object type u8, four UUIDs as 16 bytes,
 * each identity as u16 byte length + strict UTF-8, then size u64, chunkSize u32,
 * chunkCount u32, and chunkIndex u32 (0xffffffff for MANIFEST). All integers BE.
 * Conversation and stable pinned identities survive session renewal, so durable
 * transfers do not silently move to a replacement identity or bind to an ephemeral session.
 */
export const encodeAttachmentContext = (type: AttachmentObjectType, context: AttachmentAuthenticatedContext): Uint8Array => {
    if (!context || (type !== 'manifest' && type !== 'chunk') || !UUID.test(context.transferId) || !UUID.test(context.conversationId) || !UUID.test(context.senderParticipantId) || !UUID.test(context.recipientParticipantId) || context.senderParticipantId === context.recipientParticipantId || context.senderIdentityReference === context.recipientIdentityReference || !IDENTITY_REFERENCE.test(context.senderIdentityReference) || !IDENTITY_REFERENCE.test(context.recipientIdentityReference) || !Number.isSafeInteger(context.fileSize) || context.fileSize < 1 || context.fileSize > 50 * 1024 * 1024 || context.chunkSize < 1 || context.chunkSize > 256 * 1024 || context.chunkCount !== Math.ceil(context.fileSize / context.chunkSize) || context.chunkCount < 1 || context.chunkCount > 256) throw new Error('Invalid attachment context.');
    const sender = validString(context.senderIdentityReference, 512); const recipient = validString(context.recipientIdentityReference, 512);
    const index = type === 'manifest' ? 0xffff_ffff : context.chunkIndex;
    if (type === 'chunk' && (!Number.isSafeInteger(index) || index! < 0 || index! >= context.chunkCount)) throw new Error('Invalid attachment context.');
    if (type === 'manifest' && context.chunkIndex !== undefined) throw new Error('Invalid attachment context.');
    return concat(encoder.encode('k3ncrypt/attachment-aad/v2\0'), new Uint8Array([2, type === 'manifest' ? 1 : 2]), uuidBytes(context.transferId), uuidBytes(context.conversationId), uuidBytes(context.senderParticipantId), uuidBytes(context.recipientParticipantId), unsigned(sender.length, 2), sender, unsigned(recipient.length, 2), recipient, unsigned(context.fileSize, 8), unsigned(context.chunkSize, 4), unsigned(context.chunkCount, 4), unsigned(index!, 4));
};
