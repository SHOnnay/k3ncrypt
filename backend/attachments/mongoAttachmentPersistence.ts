import { Binary, type Collection, type Db } from 'mongodb';
import type { EncryptedAttachmentChunk } from '../../service/src/attachments/contracts';
import type { AttachmentChunkPersistence, AttachmentMetadataPersistence, PersistentAttachmentPersistence, PersistentAttachmentRecord } from '../../service/src/attachments/persistentDelivery';

type MetadataDocument = Omit<PersistentAttachmentRecord, 'encryptedMetadata'> & { encryptedMetadata: { nonce: Buffer | Binary; ciphertext: Buffer | Binary } };
type ChunkDocument = Omit<EncryptedAttachmentChunk, 'nonce' | 'ciphertext'> & { nonce: Buffer | Binary; ciphertext: Buffer | Binary; storedAt: number };
/** The driver returns BSON Binary by default (promoteBuffers is false).
 * Copy only logical bytes, never a Binary object's spare backing capacity.
 * Unexpected persisted representations fail closed instead of becoming empty bytes.
 */
const bytes = (value: Buffer | Binary): Uint8Array => {
    if (Buffer.isBuffer(value)) return new Uint8Array(value);
    if (value instanceof Binary && value.sub_type === Binary.SUBTYPE_DEFAULT &&
        Number.isInteger(value.position) && value.position >= 0 && value.position <= value.buffer.byteLength) {
        return new Uint8Array(value.value());
    }
    throw new Error('Attachment binary storage unavailable.');
};
const metadataDocument = (record: PersistentAttachmentRecord): MetadataDocument => ({ ...record, encryptedMetadata: { nonce: Buffer.from(record.encryptedMetadata.nonce), ciphertext: Buffer.from(record.encryptedMetadata.ciphertext) } });
const metadataRecord = (document: MetadataDocument): PersistentAttachmentRecord => ({ ...document, encryptedMetadata: { nonce: bytes(document.encryptedMetadata.nonce), ciphertext: bytes(document.encryptedMetadata.ciphertext) } });
const chunkDocument = (chunk: EncryptedAttachmentChunk): ChunkDocument => ({ ...chunk, nonce: Buffer.from(chunk.nonce), ciphertext: Buffer.from(chunk.ciphertext), storedAt: Date.now() });
const chunkRecord = (document: ChunkDocument): EncryptedAttachmentChunk => ({ attachmentId: document.attachmentId, index: document.index, total: document.total, nonce: bytes(document.nonce), ciphertext: bytes(document.ciphertext) });

/** Mongo persistence only; it never decrypts or interprets ciphertext. */
export class MongoAttachmentPersistence implements PersistentAttachmentPersistence {
    readonly metadata: AttachmentMetadataPersistence;
    readonly chunks: AttachmentChunkPersistence;
    private readonly metadataCollection: Collection<MetadataDocument>;
    private readonly chunkCollection: Collection<ChunkDocument>;

    constructor(db: Db, metadataName = 'attachment_metadata', chunkName = 'attachment_chunks') {
        this.metadataCollection = db.collection<MetadataDocument>(metadataName);
        this.chunkCollection = db.collection<ChunkDocument>(chunkName);
        this.metadata = {
            find: async (id) => { const document = await this.metadataCollection.findOne({ id }); return document ? metadataRecord(document) : undefined; },
            insert: async (record) => { await this.metadataCollection.insertOne(metadataDocument(record)); },
            updateStatus: async (id, status) => { await this.metadataCollection.updateOne({ id }, { $set: { status } }); },
            expired: async (now) => (await this.metadataCollection.find({ expiresAt: { $lte: now }, status: { $nin: ['expired', 'deleted'] } }).toArray()).map(metadataRecord),
        };
        this.chunks = {
            find: async (id, index) => { const document = await this.chunkCollection.findOne({ attachmentId: id, index }); return document ? chunkRecord(document) : undefined; },
            list: async (id) => (await this.chunkCollection.find({ attachmentId: id }).sort({ index: 1 }).toArray()).map(chunkRecord),
            insert: async (chunk) => { await this.chunkCollection.insertOne(chunkDocument(chunk)); },
            delete: async (id) => { await this.chunkCollection.deleteMany({ attachmentId: id }); },
        };
    }

    async ensureIndexes(): Promise<void> {
        await this.metadataCollection.createIndex({ id: 1 }, { unique: true });
        await this.metadataCollection.createIndex({ expiresAt: 1, status: 1 });
        await this.chunkCollection.createIndex({ attachmentId: 1, index: 1 }, { unique: true });
        await this.chunkCollection.createIndex({ attachmentId: 1, storedAt: 1 });
    }
}
