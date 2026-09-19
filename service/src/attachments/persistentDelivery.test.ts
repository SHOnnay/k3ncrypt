import { encryptAttachment } from './crypto';
import { PersistentAttachmentDeliveryStore, type PersistentAttachmentPersistence, type PersistentAttachmentRecord } from './persistentDelivery';
import type { AttachmentId, EncryptedAttachmentChunk } from './contracts';

class DurableTestPersistence implements PersistentAttachmentPersistence {
    readonly records = new Map<string, PersistentAttachmentRecord>();
    readonly chunkRecords = new Map<string, EncryptedAttachmentChunk>();
    metadata = {
        find: async (id: AttachmentId) => this.records.get(id),
        insert: async (record: PersistentAttachmentRecord) => { if (this.records.has(record.id)) throw new Error('duplicate'); this.records.set(record.id, { ...record }); },
        updateStatus: async (id: AttachmentId, status: PersistentAttachmentRecord['status']) => { const record = this.records.get(id); if (!record) throw new Error('missing'); record.status = status; },
        expired: async (now: number) => [...this.records.values()].filter((record) => record.expiresAt <= now && !['expired', 'deleted'].includes(record.status)),
    };
    chunkStore = {
        find: async (id: AttachmentId, index: number) => this.chunkRecords.get(`${id}:${index}`),
        list: async (id: AttachmentId) => [...this.chunkRecords.values()].filter((chunk) => chunk.attachmentId === id),
        insert: async (chunk: EncryptedAttachmentChunk) => { const key = `${chunk.attachmentId}:${chunk.index}`; if (this.chunkRecords.has(key)) throw new Error('duplicate'); this.chunkRecords.set(key, chunk); },
        delete: async (id: AttachmentId) => { for (const key of this.chunkRecords.keys()) if (key.startsWith(`${id}:`)) this.chunkRecords.delete(key); },
    };
    chunks = this.chunkStore;
}

const persistence = (): PersistentAttachmentPersistence => { const value = new DurableTestPersistence(); return { metadata: value.metadata, chunks: value.chunkStore }; };

it('survives adapter restart and retrieves completed ciphertext', async () => {
    const backing = new DurableTestPersistence();
    const durable: PersistentAttachmentPersistence = { metadata: backing.metadata, chunks: backing.chunks };
    const first = new PersistentAttachmentDeliveryStore(durable);
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), new Uint8Array(32), '11111111-1111-4111-8111-111111111111');
    const token = 'persistent-token';
    await first.initializeUpload({ ...encrypted.reference, status: 'uploading' }, token);
    expect(backing.records.get(encrypted.reference.id)).not.toHaveProperty('key');
    expect(backing.records.get(encrypted.reference.id)?.accessHash).not.toBe(token);
    await first.storeChunk(encrypted.chunks[0], token);
    await first.completeUpload(encrypted.reference.id, token);
    const restarted = new PersistentAttachmentDeliveryStore(durable);
    await expect(restarted.getChunks(encrypted.reference.id, token)).resolves.toHaveLength(1);
});

it('rejects unauthorized, conflicting duplicate, and expired access', async () => {
    const durable = persistence();
    let clock = Date.now();
    const store = new PersistentAttachmentDeliveryStore(durable, () => clock);
    const encrypted = await encryptAttachment(new Uint8Array([4, 5, 6]), new Uint8Array(32), '22222222-2222-4222-8222-222222222222');
    await store.initializeUpload({ ...encrypted.reference, status: 'uploading' }, 'correct-token');
    await expect(store.getChunks(encrypted.reference.id, 'wrong-token')).rejects.toThrow('unavailable');
    await store.storeChunk(encrypted.chunks[0], 'correct-token');
    await expect(store.storeChunk({ ...encrypted.chunks[0], ciphertext: new Uint8Array([9]) }, 'correct-token')).rejects.toThrow('Conflicting');
    clock = encrypted.reference.expiresAt;
    await expect(store.getChunks(encrypted.reference.id, 'correct-token')).rejects.toThrow('expired');
});
