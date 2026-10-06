import { readFileSync } from 'fs';
import { resolve } from 'path';
import { openAttachmentManifest, openAttachmentChunk, sealAttachmentManifest, sealAttachmentChunk } from '../attachments/portableAead';
import { validateFileContext, serializeFileReference, parseFileReference, b64 } from './protocol';
import { type AttachmentAuthenticatedContext } from '../attachments/portableContext';
const fixture = Object.fromEntries(readFileSync(resolve(process.cwd(), 'protocol-fixtures/v1/file-transfer-v2.properties'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const hex = (v: string): Uint8Array => new Uint8Array(Buffer.from(v, 'hex'));
for (const direction of ['web', 'android']) test(`${direction} sender sealed V2 flow opens identically on both receivers and emits the shared bytes`, async () => {
    const c: AttachmentAuthenticatedContext = { transferId: fixture[`${direction}.transferId`], conversationId: fixture[`${direction}.conversationId`], senderParticipantId: fixture[`${direction}.senderParticipantId`], recipientParticipantId: fixture[`${direction}.recipientParticipantId`], senderIdentityReference: fixture[`${direction}.senderIdentityReference`], recipientIdentityReference: fixture[`${direction}.recipientIdentityReference`], fileSize: 11, chunkSize: 262144, chunkCount: 1 };
    validateFileContext(c); const key = hex(fixture.key); const manifestObject = { nonce: hex(fixture[`${direction}.manifestNonce`]), ciphertext: hex(fixture[`${direction}.manifestCiphertext`]) }; const chunkObject = { nonce: hex(fixture[`${direction}.chunkNonce`]), ciphertext: hex(fixture[`${direction}.chunkCiphertext`]) };
    const manifest = await openAttachmentManifest(key, c, manifestObject); expect(manifest).toMatchObject({ fileSize: 11, chunkCount: 1, filename: fixture.filename, mimeType: 'image/jpeg' });
    expect(await openAttachmentChunk(key, { ...c, chunkIndex: 0 }, chunkObject)).toEqual(hex(fixture.plaintext));
    const nonces = [manifestObject.nonce, chunkObject.nonce]; let at = 0;
    const random = jest.spyOn(crypto, 'getRandomValues').mockImplementation(((target: ArrayBufferView) => { new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(nonces[at++]); return target; }) as typeof crypto.getRandomValues);
    try { expect(await sealAttachmentManifest(key, c, manifest)).toEqual(manifestObject); expect(await sealAttachmentChunk(key, { ...c, chunkIndex: 0 }, hex(fixture.plaintext))).toEqual(chunkObject); } finally { random.mockRestore(); }
    expect(parseFileReference(serializeFileReference({ version: 2, context: c, key: b64(key), createdAt: Number(fixture.createdAt), expiresAt: Number(fixture.expiresAt) })).context).toEqual(c);
});
