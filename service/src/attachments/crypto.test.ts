import { decryptAttachment, encryptAttachment, generateAttachmentKey } from './crypto';
import { MemoryAttachmentStorage } from './storage';

describe('encrypted attachment foundation', () => {
    it('encrypts, chunks, stores, and decrypts without plaintext metadata', async () => {
        const plaintext = new TextEncoder().encode('private attachment content');
        const key = generateAttachmentKey();
        const encrypted = await encryptAttachment(plaintext, key, 'attachment-test');
        expect(encrypted.reference.encryptedMetadata.ciphertext).not.toEqual(plaintext);
        const storage = new MemoryAttachmentStorage();
        await storage.createUpload(encrypted.reference);
        for (const chunk of encrypted.chunks) await storage.storeChunk(chunk);
        await storage.finalizeUpload(encrypted.reference.id);
        const chunks = await Promise.all(encrypted.chunks.map((chunk) => storage.getChunk(encrypted.reference.id, chunk.index)));
        expect(await decryptAttachment(encrypted.reference, chunks.filter(Boolean) as typeof encrypted.chunks, key)).toEqual(plaintext);
    });

    it('fails closed for wrong keys, corruption, missing, and reordered chunks', async () => {
        const encrypted = await encryptAttachment(new Uint8Array(400_000), generateAttachmentKey(), 'integrity-test');
        await expect(decryptAttachment(encrypted.reference, encrypted.chunks, generateAttachmentKey())).rejects.toThrow('integrity');
        const corrupted = encrypted.chunks.map((chunk) => ({ ...chunk, ciphertext: new Uint8Array(chunk.ciphertext) }));
        corrupted[0].ciphertext[0] ^= 1;
        await expect(decryptAttachment(encrypted.reference, corrupted, generateAttachmentKey())).rejects.toThrow('integrity');
        await expect(decryptAttachment(encrypted.reference, encrypted.chunks.slice(1), generateAttachmentKey())).rejects.toThrow('integrity');
        const reordered = [...encrypted.chunks].reverse().map((chunk, index) => ({ ...chunk, index }));
        await expect(decryptAttachment(encrypted.reference, reordered, generateAttachmentKey())).rejects.toThrow('integrity');
    });
});
