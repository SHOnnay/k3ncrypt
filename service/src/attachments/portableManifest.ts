export interface AttachmentManifestV2 { fileSize: number; chunkSize: number; chunkCount: number; createdAt: number; expiresAt: number; filename: string; mimeType: string; }
const encoder = new TextEncoder();
const concat = (...items: Uint8Array[]): Uint8Array => { const out = new Uint8Array(items.reduce((n, x) => n + x.length, 0)); let at = 0; for (const item of items) { out.set(item, at); at += item.length; } return out; };
const integer = (value: number, width: number): Uint8Array => {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (width * 8)) throw new Error('Invalid attachment manifest.');
    const result = new Uint8Array(width); let rest = value; for (let i = width - 1; i >= 0; i -= 1) { result[i] = rest % 256; rest = Math.floor(rest / 256); } return result;
};
const safeName = (value: string): string => {
    if (typeof value !== 'string' || value.length > 512 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('Invalid attachment filename.');
    const result = Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/gu, '_').replace(/^[. ]+|[. ]+$/g, '')).slice(0, 120).join('');
    return !result || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result) ? 'protected-file' : result;
};
const mime = (value: string): string => typeof value === 'string' && value.length <= 127 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value) ? value.toLowerCase() : 'application/octet-stream';
/** Manifest v2: fixed domain, u64 size/created/expires, u32 chunkSize/count, then u16-length UTF-8 filename and MIME. Big-endian throughout. */
export const encodeAttachmentManifest = (value: AttachmentManifestV2): Uint8Array => {
    if (!Number.isSafeInteger(value.fileSize) || value.fileSize < 1 || value.fileSize > 50 * 1024 * 1024 || !Number.isSafeInteger(value.chunkSize) || value.chunkSize < 1 || value.chunkSize > 256 * 1024 || !Number.isSafeInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount !== Math.ceil(value.fileSize / value.chunkSize) || value.chunkCount > 256 || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > 7 * 24 * 60 * 60 * 1000) throw new Error('Invalid attachment manifest.');
    const name = encoder.encode(safeName(value.filename)); const contentType = encoder.encode(mime(value.mimeType));
    if (name.length > 1024 || contentType.length > 127) throw new Error('Invalid attachment manifest.');
    return concat(encoder.encode('k3ncrypt/manifest/v2\0'), integer(value.fileSize, 8), integer(value.chunkSize, 4), integer(value.chunkCount, 4), integer(value.createdAt, 8), integer(value.expiresAt, 8), integer(name.length, 2), name, integer(contentType.length, 2), contentType);
};
export const decodeAttachmentManifest = (bytes: Uint8Array): AttachmentManifestV2 => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const domain = encoder.encode('k3ncrypt/manifest/v2\0');
    if (bytes.length < domain.length + 36 || !domain.every((value, index) => bytes[index] === value)) throw new Error('Invalid attachment manifest.');
    let at = domain.length;
    const u64 = (): number => { const result = view.getBigUint64(at, false); at += 8; if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid attachment manifest.'); return Number(result); };
    const fileSize = u64(); const chunkSize = view.getUint32(at, false); at += 4; const chunkCount = view.getUint32(at, false); at += 4; const createdAt = u64(); const expiresAt = u64();
    const take = (max: number): Uint8Array => { if (at + 2 > bytes.length) throw new Error('Invalid attachment manifest.'); const length = view.getUint16(at, false); at += 2; if (length > max || at + length > bytes.length) throw new Error('Invalid attachment manifest.'); const part = bytes.slice(at, at + length); at += length; return part; };
    const decoder = new TextDecoder('utf-8', { fatal: true }); const filename = decoder.decode(take(1024)); const mimeType = decoder.decode(take(127));
    if (at !== bytes.length) throw new Error('Invalid attachment manifest.');
    const manifest = { fileSize, chunkSize, chunkCount, createdAt, expiresAt, filename, mimeType };
    if (encodeAttachmentManifest(manifest).some((value, index) => value !== bytes[index])) throw new Error('Invalid attachment manifest.');
    return manifest;
};
