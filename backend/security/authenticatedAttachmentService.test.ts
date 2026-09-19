import { AttachmentService } from '../../service/src/attachments/service';
import { MemoryAttachmentDeliveryStore } from '../../service/src/attachments/delivery';
import { AuthenticatedAttachmentService } from './authenticatedAttachmentService';
import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext, type ConversationMembershipStore } from './authorizationContext';

const room = '11111111-1111-4111-8111-111111111111';
const base = (requestId: string, participantId = 'alice'): AuthenticatedContext => ({ sessionId: 'session-1', participantId, conversationId: room, permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'], requestId, createdAt: 1, expiresAt: Date.now() + 60_000 });
const members: ConversationMembershipStore = { isMember: async (conversationId, participantId) => conversationId === room && ['alice', 'bob'].includes(participantId) };

it('allows an authenticated owner upload and denies an unauthorized download', async () => {
  const access = new MemoryAttachmentAccessStore();
  const service = new AuthenticatedAttachmentService(new ConversationAuthorizationService(members, access), new AttachmentService(new MemoryAttachmentDeliveryStore()), access);
  const created = await service.createUpload(base('11111111-1111-4111-8111-111111111111'), { size: 1, chunkCount: 1, encryptedMetadata: { nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }, expiresAt: Date.now() + 10_000 });
  await expect(service.getChunks(base('22222222-2222-4222-8222-222222222222', 'mallory'), created.id, created.capability)).rejects.toThrow('Authorization failed');
});
