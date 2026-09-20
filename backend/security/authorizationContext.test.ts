import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext, type ConversationMembershipStore } from './authorizationContext';

const room = '11111111-1111-4111-8111-111111111111';
const request = '22222222-2222-4222-8222-222222222222';
const context = (overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext => ({ sessionId: 'session-1', participantId: 'alice', conversationId: room, permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'], requestId: request, createdAt: 10, expiresAt: 100, ...overrides });
const memberships: ConversationMembershipStore = { isMember: async (conversationId, participantId) => conversationId === room && ['alice', 'bob'].includes(participantId) };

it('authorizes a valid member and rejects request replay', async () => {
  const service = new ConversationAuthorizationService(memberships, new MemoryAttachmentAccessStore(), () => 20);
  await expect(service.authorizeConversation(context(), room, 'attachment:create')).resolves.toBeUndefined();
  await expect(service.authorizeConversation(context(), room, 'attachment:create')).rejects.toThrow('Authorization failed');
});

it('fails closed for wrong participant, conversation, and expiry', async () => {
  const service = new ConversationAuthorizationService(memberships, new MemoryAttachmentAccessStore(), () => 20);
  await expect(service.authorizeConversation(context({ participantId: 'mallory', requestId: '33333333-3333-4333-8333-333333333333' }), room, 'attachment:create')).rejects.toThrow('Authorization failed');
  await expect(service.authorizeConversation(context({ conversationId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444' }), room, 'attachment:create')).rejects.toThrow('Authorization failed');
  await expect(service.authorizeConversation(context({ expiresAt: 20, requestId: '55555555-5555-4555-8555-555555555555' }), room, 'attachment:create')).rejects.toThrow('Authorization failed');
});

it('prevents cross-conversation attachment access', async () => {
  const access = new MemoryAttachmentAccessStore();
  await access.register('attachment-1', { conversationId: room, ownerParticipantId: 'alice' });
  const service = new ConversationAuthorizationService(memberships, access, () => 20);
  await expect(service.authorizeAttachment(context({ requestId: '66666666-6666-4666-8666-666666666666' }), 'attachment-1', 'attachment:read')).resolves.toMatchObject({ conversationId: room });
  await expect(service.authorizeAttachment(context({ conversationId: '33333333-3333-4333-8333-333333333333', requestId: '77777777-7777-4777-8777-777777777777' }), 'attachment-1', 'attachment:read')).rejects.toThrow('Authorization failed');
});

it('rejects attachment authorization when the lifecycle trust adapter reports revocation', async () => {
  const service = new ConversationAuthorizationService(memberships, new MemoryAttachmentAccessStore(), () => 20);
  const revokedTrust = { assertTrusted: async () => { throw new Error('Device trust is unavailable.'); } };
  await expect(service.authorizeConversation(context({ requestId: '88888888-8888-4888-8888-888888888888', deviceTrust: revokedTrust }), room, 'attachment:create')).rejects.toThrow('Device trust');
});
