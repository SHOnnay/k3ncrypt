import { encryptAttachment } from './crypto';
import { AttachmentService } from './service';
import { MemoryAttachmentDeliveryStore } from './delivery';

it('authorizes an existing conversation context through one upload capability', async () => {
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), new Uint8Array(32), 'service-test');
    const service = new AttachmentService(new MemoryAttachmentDeliveryStore());
    const context = { conversationId: 'conversation-1', participantId: 'participant-1' };
    const created = await service.createUpload(context, { size: encrypted.reference.size, chunkCount: encrypted.reference.chunkCount, encryptedMetadata: encrypted.reference.encryptedMetadata, expiresAt: Date.now() + 60_000 });
    await service.storeChunk(context, created.id, created.capability, { ...encrypted.chunks[0], attachmentId: created.id });
    await service.completeUpload(context, created.id, created.capability);
    await expect(service.getChunks({ ...context, participantId: 'unknown' }, created.id, created.capability)).rejects.toThrow('unavailable');
    const wrongCapability = `${created.capability[0] === '0' ? '1' : '0'}${created.capability.slice(1)}`;
    await expect(service.getChunks(context, created.id, wrongCapability)).rejects.toThrow('unavailable');
    expect((await service.getChunks(context, created.id, created.capability)).length).toBe(1);
});

it('rejects missing conversation authorization and invalid upload limits', async () => {
    const service = new AttachmentService(new MemoryAttachmentDeliveryStore());
    await expect(service.createUpload({ conversationId: '', participantId: 'p' }, { size: 1, chunkCount: 1, encryptedMetadata: { nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }, expiresAt: Date.now() + 1_000 })).rejects.toThrow('authorization');
});
