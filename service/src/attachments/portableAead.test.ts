import { readFileSync } from 'fs';
import { resolve } from 'path';
import { encodeAttachmentContext, type AttachmentAuthenticatedContext } from './portableContext';
import { decodeAttachmentManifest, encodeAttachmentManifest } from './portableManifest';
import { openAttachmentChunk, openAttachmentManifest, openAttachmentObject, sealAttachmentChunk, sealAttachmentManifest, sealAttachmentObject } from './portableAead';

const fixture = Object.fromEntries(readFileSync(resolve(process.cwd(), 'protocol-fixtures/v1/attachment-aead-v2.properties'), 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
const hex = (value: string): Uint8Array => Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
const toHex = (value: Uint8Array): string => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const b64 = (value: Uint8Array): string => Buffer.from(value).toString('base64');
const context = (chunkIndex?: number): AttachmentAuthenticatedContext => ({ transferId: fixture.transferId, conversationId: fixture.conversationId, senderParticipantId: fixture.senderParticipantId, recipientParticipantId: fixture.recipientParticipantId, senderIdentityReference: fixture.senderIdentityReference, recipientIdentityReference: fixture.recipientIdentityReference, fileSize: Number(fixture.fileSize), chunkSize: Number(fixture.chunkSize), chunkCount: Number(fixture.chunkCount), ...(chunkIndex === undefined ? {} : { chunkIndex }) });
const manifest = { fileSize: 11, chunkSize: 4, chunkCount: 3, createdAt: 1, expiresAt: 86400001, filename: 'vector.txt', mimeType: 'text/plain' };
it('encodes a canonical context and manifest and opens shared Java AES-GCM vectors', async () => {
    expect(toHex(encodeAttachmentContext('manifest', context()))).toBe(fixture.manifestAadHex);
    expect(toHex(encodeAttachmentContext('chunk', context(1)))).toBe(fixture.chunkAadHex);
    expect(toHex(encodeAttachmentManifest(manifest))).toBe(fixture.manifestPlaintextHex);
    expect(decodeAttachmentManifest(hex(fixture.manifestPlaintextHex))).toEqual(manifest);
    const key = hex(fixture.key);
    const fixed = [hex(fixture.manifestNonce), hex(fixture.chunkNonce)]; let call = 0;
    const randomSpy = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((target: ArrayBufferView) => { new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(fixed[call++]); return target; }) as typeof globalThis.crypto.getRandomValues);
    try {
        const webManifest = await sealAttachmentObject(key, 'manifest', context(), hex(fixture.manifestPlaintextHex));
        expect(toHex(webManifest.nonce)).toBe(fixture.manifestNonce); expect(toHex(webManifest.ciphertext)).toBe(fixture.manifestCiphertext);
        const webChunk = await sealAttachmentObject(key, 'chunk', context(1), hex(fixture.chunkPlaintextHex));
        expect(toHex(webChunk.nonce)).toBe(fixture.chunkNonce); expect(toHex(webChunk.ciphertext)).toBe(fixture.chunkCiphertext);
    } finally { randomSpy.mockRestore(); }
    await expect(openAttachmentObject(key, 'manifest', context(), { nonce: hex(fixture.manifestNonce), ciphertext: hex(fixture.manifestCiphertext) })).resolves.toEqual(hex(fixture.manifestPlaintextHex));
    await expect(openAttachmentObject(key, 'chunk', context(1), { nonce: hex(fixture.chunkNonce), ciphertext: hex(fixture.chunkCiphertext) })).resolves.toEqual(hex(fixture.chunkPlaintextHex));
    await expect(openAttachmentManifest(key, context(), { nonce: hex(fixture.manifestNonce), ciphertext: hex(fixture.manifestCiphertext) })).resolves.toEqual(manifest);
    await expect(openAttachmentChunk(key, context(1), { nonce: hex(fixture.chunkNonce), ciphertext: hex(fixture.chunkCiphertext) })).resolves.toEqual(hex(fixture.chunkPlaintextHex));
    // Independent Node/JCA-compatible vectors include the GCM tag appended to ciphertext.
    expect(b64(hex(fixture.manifestCiphertext))).toBe(fixture.manifestCiphertextBase64);
});
it('rejects every bound-field, object-domain, nonce, ciphertext, and tag mutation', async () => {
    const key = hex(fixture.key); const nonce = hex(fixture.chunkNonce); const ciphertext = hex(fixture.chunkCiphertext); const aad = encodeAttachmentContext('chunk', context(1));
    const mutations = [
        { ...context(1), transferId: '55555555-5555-4555-8555-555555555555' },
        { ...context(1), conversationId: '55555555-5555-4555-8555-555555555555' },
        { ...context(1), senderParticipantId: '55555555-5555-4555-8555-555555555555' },
        { ...context(1), recipientParticipantId: '55555555-5555-4555-8555-555555555555' },
        { ...context(1), senderIdentityReference: 'K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ' },
        { ...context(1), recipientIdentityReference: 'K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ' },
        context(2),
    ];
    for (const changed of mutations) await expect(openAttachmentObject(key, 'chunk', changed, { nonce, ciphertext })).rejects.toThrow('authentication');
    await expect(openAttachmentObject(key, 'manifest', context(), { nonce, ciphertext })).rejects.toThrow('authentication');
    await expect(openAttachmentObject(key, 'chunk', context(1), { nonce: hex(fixture.manifestNonce), ciphertext: hex(fixture.manifestCiphertext) })).rejects.toThrow('authentication');
    const alteredNonce = new Uint8Array(nonce); alteredNonce[0] ^= 1;
    await expect(openAttachmentObject(key, 'chunk', context(1), { nonce: alteredNonce, ciphertext })).rejects.toThrow('authentication');
    const alteredCiphertext = new Uint8Array(ciphertext); alteredCiphertext[0] ^= 1;
    await expect(openAttachmentObject(key, 'chunk', context(1), { nonce, ciphertext: alteredCiphertext })).rejects.toThrow('authentication');
    const alteredTag = new Uint8Array(ciphertext); alteredTag[alteredTag.length - 1] ^= 1;
    await expect(openAttachmentObject(key, 'chunk', context(1), { nonce, ciphertext: alteredTag })).rejects.toThrow('authentication');
    expect(aad.length).toBeGreaterThan(0);
    expect(() => encodeAttachmentContext('manifest', { ...context(), recipientIdentityReference: context().senderIdentityReference })).toThrow();
    await expect(Promise.resolve().then(() => sealAttachmentManifest(key, context(), { ...manifest, fileSize: 12 }))).rejects.toThrow('mismatch');
    await expect(Promise.resolve().then(() => sealAttachmentChunk(key, context(1), new Uint8Array(3)))).rejects.toThrow('length');
});
it('fails closed for malformed identifiers, strings, indices and manifest bytes', () => {
    expect(() => encodeAttachmentContext('chunk', { ...context(1), chunkIndex: 3 })).toThrow();
    expect(() => encodeAttachmentContext('manifest', { ...context(), conversationId: 'not-a-uuid' })).toThrow();
    expect(() => encodeAttachmentContext('manifest', { ...context(), senderIdentityReference: 'display name' })).toThrow();
    expect(() => decodeAttachmentManifest(hex(fixture.manifestPlaintextHex).slice(0, -1))).toThrow();
    expect(decodeAttachmentManifest(encodeAttachmentManifest({ ...manifest, filename: ' .foo. ' })).filename).toBe('foo');
});
