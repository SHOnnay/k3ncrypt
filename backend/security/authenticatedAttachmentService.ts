import type { AttachmentService, CreateAttachmentUpload, CreatedAttachmentUpload, EncryptedAttachmentChunk } from '../../service/src/attachments';
import type { AuthenticatedContext, AttachmentAccessStore, ConversationAuthorizationService } from './authorizationContext';

/** Attachment operations guarded by an already-authenticated conversation context. */
export class AuthenticatedAttachmentService {
  constructor(private readonly authorization: ConversationAuthorizationService, private readonly attachments: AttachmentService, private readonly access: AttachmentAccessStore) {}

  async createUpload(context: AuthenticatedContext, input: CreateAttachmentUpload): Promise<CreatedAttachmentUpload> {
    await this.authorization.authorizeConversation(context, context.conversationId, 'attachment:create');
    const created = await this.attachments.createUpload({ conversationId: context.conversationId, participantId: context.participantId }, input);
    await this.access.register(created.id, { conversationId: context.conversationId, ownerParticipantId: context.participantId });
    return created;
  }

  async storeChunk(context: AuthenticatedContext, id: string, capability: string, chunk: EncryptedAttachmentChunk): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:write');
    await this.attachments.storeChunk({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability, chunk);
  }

  async completeUpload(context: AuthenticatedContext, id: string, capability: string): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:write');
    await this.attachments.completeUpload({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
  }

  async getChunks(context: AuthenticatedContext, id: string, capability: string): Promise<EncryptedAttachmentChunk[]> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:read');
    return this.attachments.getChunks({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
  }

  async deleteAttachment(context: AuthenticatedContext, id: string, capability: string): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:delete');
    await this.attachments.deleteAttachment({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
  }
}
