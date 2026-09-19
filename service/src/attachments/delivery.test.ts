import { encryptAttachment } from './crypto';
import { MemoryAttachmentDeliveryStore } from './delivery';

it('supports resumable ciphertext upload, authorized retrieval, deletion, and expiry', async () => {
    const key = new Uint8Array(32);
    const encrypted = await encryptAttachment(new Uint8Array(300_000), key, 'delivery-test');
    const store = new MemoryAttachmentDeliveryStore();
    const now = Date.now();
    await store.initializeUpload({ ...encrypted.reference, status: 'uploading' }, 'participant-token');
    await expect(store.getChunks(encrypted.reference.id, 'wrong-token')).rejects.toThrow('unavailable');
    await store.storeChunk(encrypted.chunks[0], 'participant-token');
    await expect(store.completeUpload(encrypted.reference.id, 'participant-token')).rejects.toThrow('incomplete');
    await store.storeChunk(encrypted.chunks[0], 'participant-token');
    if (encrypted.chunks[1]) await store.storeChunk(encrypted.chunks[1], 'participant-token');
    await store.completeUpload(encrypted.reference.id, 'participant-token');
    expect((await store.getAttachmentStatus(encrypted.reference.id, 'participant-token')).status).toBe('complete');
    await store.deleteAttachment(encrypted.reference.id, 'participant-token');
    expect(await store.expireAttachments(now)).toBe(0);
});
