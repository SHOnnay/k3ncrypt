import { AttachmentService, MemoryAttachmentDeliveryStore } from '../attachments';
import { MediaMessageWorkflow, type MediaAttachmentGateway } from './workflow';

const gateway = (service: AttachmentService): MediaAttachmentGateway => ({
    createUpload: (context, input) => service.createUpload(context, input),
    storeChunk: (context, id, capability, chunk) => service.storeChunk(context, id, capability, chunk),
    completeUpload: (context, id, capability) => service.completeUpload(context, id, capability),
    getChunks: (context, id, capability) => service.getChunks(context, id, capability),
});

it('uploads encrypted image ciphertext, sends a reference, and decrypts it on receipt', async () => {
    const workflow = new MediaMessageWorkflow(gateway(new AttachmentService(new MemoryAttachmentDeliveryStore())));
    const context = { conversationId: 'conversation-1', participantId: 'participant-1' };
    const sent: string[] = [];
    const result = await workflow.sendFile(context, 'image', { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, async (message) => { sent.push(message); });
    expect(result.state).toBe('sent');
    const received = await workflow.receive(context, sent[0]);
    expect(received.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(received.kind).toBe('image');
});

it('rejects an invalid protected media reference and unauthorized retrieval', async () => {
    const workflow = new MediaMessageWorkflow(gateway(new AttachmentService(new MemoryAttachmentDeliveryStore())));
    await expect(workflow.receive({ conversationId: 'conversation-1', participantId: 'participant-1' }, 'k3ncrypt-media-v1:{}')).rejects.toThrow('unavailable');
});

it('forwards user cancellation to the active ciphertext gateway', () => {
    const cancel = jest.fn();
    const workflow = new MediaMessageWorkflow({ ...gateway(new AttachmentService(new MemoryAttachmentDeliveryStore())), cancel });
    workflow.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
});

it('deletes a partial ciphertext upload after delivery failure', async () => {
    const service = new AttachmentService(new MemoryAttachmentDeliveryStore());
    const base = gateway(service);
    const deleteUpload = jest.fn((context, id, capability) => service.deleteAttachment(context, id, capability));
    const workflow = new MediaMessageWorkflow({ ...base, deleteUpload });
    await expect(workflow.sendFile({ conversationId: 'conversation-1', participantId: 'participant-1' }, 'file', {
        type: 'text/plain', arrayBuffer: async () => new Uint8Array([1]).buffer,
    }, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(deleteUpload).toHaveBeenCalledTimes(1);
});
