import type { AttachmentService, CreateAttachmentUpload, CreatedAttachmentUpload, EncryptedAttachmentChunk } from '../../service/src/attachments';
import type { AuthenticatedContext, AttachmentAccessStore, ConversationAuthorizationService } from './authorizationContext';

/** Attachment operations guarded by an already-authenticated conversation context. */
export class AuthenticatedAttachmentService {
  constructor(private readonly authorization: ConversationAuthorizationService, private readonly attachments: AttachmentService, private readonly access: AttachmentAccessStore) {}

  async createUpload(context: AuthenticatedContext, input: CreateAttachmentUpload): Promise<CreatedAttachmentUpload> {
    if (input.recipientParticipantId && input.recipientIdentityReference) await this.authorization.authorizeTransferCreation(context, input.recipientParticipantId, input.recipientIdentityReference);
    else await this.authorization.authorizeConversation(context, context.conversationId, 'attachment:create');
    await this.authorization.revalidate(context);
    const created = await this.attachments.createUpload({ conversationId: context.conversationId, participantId: context.participantId }, input);
    await this.access.register(created.id, { conversationId: context.conversationId, ownerParticipantId: context.participantId, recipientParticipantId: input.recipientParticipantId, senderIdentityReference: context.identityReference, recipientIdentityReference: input.recipientIdentityReference });
    await this.authorization.revalidate(context);
    return created;
  }

  async storeChunk(context: AuthenticatedContext, id: string, capability: string, chunk: EncryptedAttachmentChunk): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:write');
    await this.authorization.revalidate(context);
    await this.attachments.storeChunk({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability, chunk);
    await this.authorization.revalidate(context);
  }

  async completeUpload(context: AuthenticatedContext, id: string, capability: string): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:write');
    await this.authorization.revalidate(context);
    await this.attachments.completeUpload({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
    await this.authorization.revalidate(context);
  }

  async getChunks(context: AuthenticatedContext, id: string, capability: string): Promise<EncryptedAttachmentChunk[]> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:read');
    await this.authorization.revalidate(context);
    const chunks = await this.attachments.getChunks({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
    await this.authorization.revalidate(context);
    return chunks;
  }

  async deleteAttachment(context: AuthenticatedContext, id: string, capability: string): Promise<void> {
    const record = await this.authorization.authorizeAttachment(context, id, 'attachment:delete');
    await this.authorization.revalidate(context);
    await this.attachments.deleteAttachment({ conversationId: record.conversationId, participantId: record.ownerParticipantId }, id, capability);
    await this.authorization.revalidate(context);
  }
}
