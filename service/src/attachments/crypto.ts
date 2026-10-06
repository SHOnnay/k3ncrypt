import { ATTACHMENT_LIMITS, type AttachmentReference, type EncryptedAttachmentChunk, type EncryptedAttachmentMetadata } from './contracts';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();

const cryptoApi = (): Crypto => {
    if (!globalThis.crypto?.subtle) throw new Error('Attachment cryptography is unavailable.');
    return globalThis.crypto;
};
const randomUUID = (): string => cryptoApi().randomUUID();

const copy = (value: Uint8Array): Uint8Array => new Uint8Array(value);
const asArrayBuffer = (value: Uint8Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(value.byteLength);
    new Uint8Array(buffer).set(value);
    return buffer;
};

const importKey = async (raw: Uint8Array): Promise<CryptoKey> => cryptoApi().subtle.importKey('raw', asArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

const aadFor = (id: string, index: number, total: number): Uint8Array => encoder.encode(`k3ncrypt-attachment-v1:${id}:${index}:${total}`);

export const generateAttachmentKey = (): Uint8Array => cryptoApi().getRandomValues(new Uint8Array(KEY_BYTES));

export const encryptAttachment = async (bytes: Uint8Array, key: Uint8Array, attachmentId = randomUUID()): Promise<{
    reference: AttachmentReference;
    chunks: EncryptedAttachmentChunk[];
}> => {
    if (bytes.byteLength > ATTACHMENT_LIMITS.maxBytes) throw new Error('Attachment exceeds the maximum size.');
    if (key.byteLength !== KEY_BYTES) throw new Error('Invalid attachment key.');
    const total = Math.max(1, Math.ceil(bytes.byteLength / ATTACHMENT_LIMITS.maxChunkBytes));
    if (total > ATTACHMENT_LIMITS.maxChunks) throw new Error('Attachment has too many chunks.');
    const cryptoKey = await importKey(key);
    const chunks: EncryptedAttachmentChunk[] = [];
    for (let index = 0; index < total; index += 1) {
        const part = bytes.slice(index * ATTACHMENT_LIMITS.maxChunkBytes, (index + 1) * ATTACHMENT_LIMITS.maxChunkBytes);
        const nonce = cryptoApi().getRandomValues(new Uint8Array(NONCE_BYTES));
        const ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(aadFor(attachmentId, index, total)) }, cryptoKey, asArrayBuffer(part)));
        chunks.push({ attachmentId, index, total, nonce: copy(nonce), ciphertext });
    }
    const createdAt = Date.now();
    const expiresAt = createdAt + ATTACHMENT_LIMITS.ttlMs;
    const metadataNonce = cryptoApi().getRandomValues(new Uint8Array(NONCE_BYTES));
    const metadataPlaintext = encoder.encode(JSON.stringify({ size: bytes.byteLength, chunkCount: total, createdAt, expiresAt }));
    const metadataCiphertext = new Uint8Array(await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(metadataNonce), additionalData: asArrayBuffer(encoder.encode(`k3ncrypt-attachment-metadata-v1:${attachmentId}`)) }, cryptoKey, asArrayBuffer(metadataPlaintext)));
    const metadata: EncryptedAttachmentMetadata = { nonce: copy(metadataNonce), ciphertext: metadataCiphertext };
    return { reference: { id: attachmentId, size: bytes.byteLength, chunkCount: total, createdAt, expiresAt, encryptedMetadata: metadata }, chunks };
};

export const decryptAttachment = async (reference: AttachmentReference, chunks: EncryptedAttachmentChunk[], key: Uint8Array): Promise<Uint8Array> => {
    if (key.byteLength !== KEY_BYTES || chunks.length !== reference.chunkCount) throw new Error('Attachment integrity check failed.');
    if ('conversationId' in reference || 'senderIdentityReference' in reference || 'recipientIdentityReference' in reference) throw new Error('Unsupported unbound attachment context.');
    await decryptAttachmentMetadata(reference, key);
    const ordered = [...chunks].sort((a, b) => a.index - b.index);
    if (ordered.some((chunk, index) => chunk.attachmentId !== reference.id || chunk.index !== index || chunk.total !== reference.chunkCount)) throw new Error('Attachment chunk ordering is invalid.');
    const cryptoKey = await importKey(key);
    const parts: Uint8Array[] = [];
    for (const chunk of ordered) {
        try { parts.push(new Uint8Array(await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(chunk.nonce), additionalData: asArrayBuffer(aadFor(reference.id, chunk.index, chunk.total)) }, cryptoKey, asArrayBuffer(chunk.ciphertext)))); }
        catch { throw new Error('Attachment integrity check failed.'); }
    }
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
    if (result.byteLength !== reference.size) throw new Error('Attachment size check failed.');
    return result;
};

/** Opens and validates the authenticated v1 metadata before any plaintext file bytes are returned. */
export const decryptAttachmentMetadata = async (reference: AttachmentReference, key: Uint8Array): Promise<{ size: number; chunkCount: number; createdAt: number; expiresAt: number }> => {
    if (key.byteLength !== KEY_BYTES || reference.encryptedMetadata.nonce.byteLength !== NONCE_BYTES || reference.encryptedMetadata.ciphertext.byteLength < 17) throw new Error('Attachment integrity check failed (manifest authentication).');
    try {
        const plaintext = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(reference.encryptedMetadata.nonce), additionalData: asArrayBuffer(encoder.encode(`k3ncrypt-attachment-metadata-v1:${reference.id}`)) }, await importKey(key), asArrayBuffer(reference.encryptedMetadata.ciphertext));
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const item = value as Record<string, unknown>;
        if (Object.keys(item).sort().join(',') !== 'chunkCount,createdAt,expiresAt,size' || !Number.isSafeInteger(item.size) || !Number.isSafeInteger(item.chunkCount) || !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.expiresAt) || item.size !== reference.size || item.chunkCount !== reference.chunkCount || (reference.createdAt !== 0 && item.createdAt !== reference.createdAt) || (reference.expiresAt !== Number.MAX_SAFE_INTEGER && item.expiresAt !== reference.expiresAt)) throw new Error();
        return item as { size: number; chunkCount: number; createdAt: number; expiresAt: number };
    } catch { throw new Error('Attachment integrity check failed (manifest authentication).'); }
};
