import { decryptAttachment } from '../attachments';
import type { AttachmentConversationContext, CreateAttachmentUpload, CreatedAttachmentUpload } from '../attachments';
import { allowedMime, type MediaKind, type PreparedMedia } from './contracts';
import { createEncryptedMediaMessage, parseEncryptedMediaMessage, serializeEncryptedMediaMessage, type EncryptedMediaMessage } from './message';
import { prepareEncryptedFile, prepareEncryptedMedia } from './prepare';

export type MediaConversationContext = AttachmentConversationContext;

/** The authenticated attachment transport used by a conversation client. */
export interface MediaAttachmentGateway {
    createUpload(context: MediaConversationContext, input: CreateAttachmentUpload): Promise<CreatedAttachmentUpload>;
    storeChunk(context: MediaConversationContext, id: string, capability: string, chunk: PreparedMedia['chunks'][number]): Promise<void>;
    completeUpload(context: MediaConversationContext, id: string, capability: string): Promise<void>;
    getChunks(context: MediaConversationContext, id: string, capability: string): Promise<PreparedMedia['chunks']>;
}

export type MediaTransferState = 'uploading' | 'sent' | 'downloading' | 'ready' | 'failed';
export interface MediaSendResult { state: 'sent'; message: EncryptedMediaMessage; serialized: string; }
export interface MediaReceiveResult { state: 'ready'; message: EncryptedMediaMessage; bytes: Uint8Array; mimeType: string; kind: MediaKind; }

const unavailable = (): Error => new Error('Protected media is unavailable.');

/** Orchestrates local media encryption, authenticated ciphertext delivery, and E2EE references. */
export class MediaMessageWorkflow {
    constructor(private readonly attachments: MediaAttachmentGateway) {}

    async sendFile(context: MediaConversationContext, kind: Exclude<MediaKind, 'voice'>, file: { arrayBuffer: () => Promise<ArrayBuffer>; type: string }, send: (serialized: string) => Promise<void>): Promise<MediaSendResult> {
        return this.sendPrepared(context, await prepareEncryptedFile(kind, file), send);
    }

    async sendVoice(context: MediaConversationContext, bytes: Uint8Array, send: (serialized: string) => Promise<void>, durationMs: number): Promise<MediaSendResult> {
        return this.sendPrepared(context, await prepareEncryptedMedia('voice', bytes, 'audio/webm;codecs=opus'), send, durationMs);
    }

    async receive(context: MediaConversationContext, serialized: string): Promise<MediaReceiveResult> {
        let message: EncryptedMediaMessage | undefined;
        try { message = parseEncryptedMediaMessage(serialized); } catch { throw unavailable(); }
        if (!message?.attachmentCapability || !allowedMime(message.kind, message.mimeType) || !Number.isSafeInteger(message.size) || message.size < 1) throw unavailable();
        const chunks = await this.attachments.getChunks(context, message.attachmentId, message.attachmentCapability);
        const reference = { id: message.attachmentId, size: message.size, chunkCount: chunks.length, createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, encryptedMetadata: { nonce: Uint8Array.from(message.encryptedMetadata.nonce), ciphertext: Uint8Array.from(message.encryptedMetadata.ciphertext) } };
        try {
            const bytes = await decryptAttachment(reference, chunks, Uint8Array.from(message.attachmentKey));
            return { state: 'ready', message, bytes, mimeType: message.mimeType, kind: message.kind };
        } catch { throw unavailable(); }
    }

    private async sendPrepared(context: MediaConversationContext, prepared: PreparedMedia, send: (serialized: string) => Promise<void>, durationMs?: number): Promise<MediaSendResult> {
        const upload = await this.attachments.createUpload(context, { id: prepared.attachment.id, size: prepared.attachment.size, chunkCount: prepared.attachment.chunkCount, encryptedMetadata: prepared.attachment.encryptedMetadata, expiresAt: prepared.attachment.expiresAt });
        for (const chunk of prepared.chunks) await this.attachments.storeChunk(context, upload.id, upload.capability, { ...chunk, attachmentId: upload.id });
        await this.attachments.completeUpload(context, upload.id, upload.capability);
        const message = { ...createEncryptedMediaMessage(prepared, durationMs), attachmentCapability: upload.capability };
        const serialized = serializeEncryptedMediaMessage(message);
        await send(serialized);
        return { state: 'sent', message, serialized };
    }
}
