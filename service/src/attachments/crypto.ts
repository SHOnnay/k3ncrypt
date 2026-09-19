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

const importKey = async (raw: Uint8Array): Promise<CryptoKey> => cryptoApi().subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

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
        const ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aadFor(attachmentId, index, total) }, cryptoKey, part));
        chunks.push({ attachmentId, index, total, nonce: copy(nonce), ciphertext });
    }
    const createdAt = Date.now();
    const expiresAt = createdAt + ATTACHMENT_LIMITS.ttlMs;
    const metadataNonce = cryptoApi().getRandomValues(new Uint8Array(NONCE_BYTES));
    const metadataPlaintext = encoder.encode(JSON.stringify({ size: bytes.byteLength, chunkCount: total, createdAt, expiresAt }));
    const metadataCiphertext = new Uint8Array(await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv: metadataNonce, additionalData: encoder.encode(`k3ncrypt-attachment-metadata-v1:${attachmentId}`) }, cryptoKey, metadataPlaintext));
    const metadata: EncryptedAttachmentMetadata = { nonce: copy(metadataNonce), ciphertext: metadataCiphertext };
    return { reference: { id: attachmentId, size: bytes.byteLength, chunkCount: total, createdAt, expiresAt, encryptedMetadata: metadata }, chunks };
};

export const decryptAttachment = async (reference: AttachmentReference, chunks: EncryptedAttachmentChunk[], key: Uint8Array): Promise<Uint8Array> => {
    if (key.byteLength !== KEY_BYTES || chunks.length !== reference.chunkCount) throw new Error('Attachment integrity check failed.');
    const ordered = [...chunks].sort((a, b) => a.index - b.index);
    if (ordered.some((chunk, index) => chunk.attachmentId !== reference.id || chunk.index !== index || chunk.total !== reference.chunkCount)) throw new Error('Attachment chunk ordering is invalid.');
    const cryptoKey = await importKey(key);
    const parts: Uint8Array[] = [];
    for (const chunk of ordered) {
        try { parts.push(new Uint8Array(await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: chunk.nonce, additionalData: aadFor(reference.id, chunk.index, chunk.total) }, cryptoKey, chunk.ciphertext))); }
        catch { throw new Error('Attachment integrity check failed.'); }
    }
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
    if (result.byteLength !== reference.size) throw new Error('Attachment size check failed.');
    return result;
};
