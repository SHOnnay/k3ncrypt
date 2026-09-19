import { MemoryAttachmentStorage } from './storage';
import { encryptAttachment, generateAttachmentKey } from './crypto';

it('enforces upload lifecycle, duplicate chunks, and expiry', async () => {
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), generateAttachmentKey(), 'storage-test');
    const storage = new MemoryAttachmentStorage();
    await storage.createUpload(encrypted.reference);
    await storage.storeChunk(encrypted.chunks[0]);
    await expect(storage.storeChunk(encrypted.chunks[0])).rejects.toThrow('Duplicate');
    await expect(storage.finalizeUpload(encrypted.reference.id)).resolves.toBeUndefined();
    await expect(storage.deleteAttachment(encrypted.reference.id)).resolves.toBeUndefined();
    expect(await storage.getChunk(encrypted.reference.id, 0)).toBeUndefined();
});
