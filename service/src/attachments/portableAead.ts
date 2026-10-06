import { type AttachmentObjectType } from './portableContext';
import { decodeAttachmentManifest, encodeAttachmentManifest, type AttachmentManifestV2 } from './portableManifest';
import { encodeAttachmentContext } from './portableContext';

export interface AttachmentCiphertext { nonce: Uint8Array; ciphertext: Uint8Array; }
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const api = (): Crypto => {
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('Attachment cryptography unavailable.');
    return globalThis.crypto;
};
const importKey = (key: Uint8Array): Promise<CryptoKey> => {
    if (key.byteLength !== KEY_BYTES) throw new Error('Invalid attachment key.');
    return api().subtle.importKey('raw', buffer(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};
/** AES-GCM returns ciphertext || 128-bit tag, matching Java Cipher.doFinal output. */
export const sealAttachmentObject = async (key: Uint8Array, type: AttachmentObjectType, context: Parameters<typeof encodeAttachmentContext>[1], plaintext: Uint8Array): Promise<AttachmentCiphertext> => {
    const nonce = api().getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(await api().subtle.encrypt({ name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(encodeAttachmentContext(type, context)), tagLength: 128 }, await importKey(key), buffer(plaintext)));
    return { nonce, ciphertext };
};
export const openAttachmentObject = async (key: Uint8Array, type: AttachmentObjectType, context: Parameters<typeof encodeAttachmentContext>[1], sealed: AttachmentCiphertext): Promise<Uint8Array> => {
    if (sealed.nonce.byteLength !== NONCE_BYTES || sealed.ciphertext.byteLength < TAG_BYTES) throw new Error('Attachment authentication failed.');
    try {
        const plaintext = await api().subtle.decrypt({ name: 'AES-GCM', iv: buffer(sealed.nonce), additionalData: buffer(encodeAttachmentContext(type, context)), tagLength: 128 }, await importKey(key), buffer(sealed.ciphertext));
        return new Uint8Array(plaintext);
    } catch { throw new Error('Attachment authentication failed.'); }
};

export const sealAttachmentManifest = (key: Uint8Array, context: Parameters<typeof encodeAttachmentContext>[1], manifest: AttachmentManifestV2): Promise<AttachmentCiphertext> => {
    if (manifest.fileSize !== context.fileSize || manifest.chunkSize !== context.chunkSize || manifest.chunkCount !== context.chunkCount) throw new Error('Attachment manifest/context mismatch.');
    return sealAttachmentObject(key, 'manifest', context, encodeAttachmentManifest(manifest));
};
export const openAttachmentManifest = async (key: Uint8Array, context: Parameters<typeof encodeAttachmentContext>[1], sealed: AttachmentCiphertext): Promise<AttachmentManifestV2> => {
    const manifest = decodeAttachmentManifest(await openAttachmentObject(key, 'manifest', context, sealed));
    if (manifest.fileSize !== context.fileSize || manifest.chunkSize !== context.chunkSize || manifest.chunkCount !== context.chunkCount) throw new Error('Attachment manifest/context mismatch.');
    return manifest;
};
const expectedChunkLength = (context: Parameters<typeof encodeAttachmentContext>[1]): number => {
    if (!Number.isSafeInteger(context.chunkIndex) || context.chunkIndex! < 0 || context.chunkIndex! >= context.chunkCount) throw new Error('Invalid attachment context.');
    return Math.min(context.chunkSize, context.fileSize - context.chunkIndex! * context.chunkSize);
};
export const sealAttachmentChunk = (key: Uint8Array, context: Parameters<typeof encodeAttachmentContext>[1], plaintext: Uint8Array): Promise<AttachmentCiphertext> => {
    if (plaintext.byteLength !== expectedChunkLength(context)) throw new Error('Attachment chunk length mismatch.');
    return sealAttachmentObject(key, 'chunk', context, plaintext);
};
export const openAttachmentChunk = async (key: Uint8Array, context: Parameters<typeof encodeAttachmentContext>[1], sealed: AttachmentCiphertext): Promise<Uint8Array> => {
    const plaintext = await openAttachmentObject(key, 'chunk', context, sealed);
    if (plaintext.byteLength !== expectedChunkLength(context)) { plaintext.fill(0); throw new Error('Attachment chunk length mismatch.'); }
    return plaintext;
};
