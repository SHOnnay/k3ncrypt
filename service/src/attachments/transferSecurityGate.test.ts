import { decryptAttachment, encryptAttachment, generateAttachmentKey } from './crypto';

/** Deliberately failing acceptance gates for the requested extension, not production implementation. */
const rejects = async (action: () => Promise<unknown>): Promise<boolean> => {
    try { await action(); return false; } catch { return true; }
};

it('requires authentication of the encrypted manifest before releasing file bytes', async () => {
    const key = generateAttachmentKey();
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), key);
    const ciphertext = new Uint8Array(encrypted.reference.encryptedMetadata.ciphertext);
    ciphertext[0] ^= 1;
    const reference = { ...encrypted.reference, encryptedMetadata: { ...encrypted.reference.encryptedMetadata, ciphertext } };
    // Boolean assertions prevent raw ciphertext/key/manifest diagnostics in failure output.
    expect(await rejects(() => decryptAttachment(reference, encrypted.chunks, key))).toBe(true);
});

it('requires explicit authenticated conversation and participant context', async () => {
    const key = generateAttachmentKey();
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), key);
    const reference = { ...encrypted.reference, conversationId: '22222222-2222-4222-8222-222222222222', senderParticipantId: 'mallory', receiverParticipantId: 'bob' };
    // The current v1 API has no trusted expected-context argument; these fields are ignored.
    expect(await rejects(() => decryptAttachment(reference, encrypted.chunks, key))).toBe(true);
});
