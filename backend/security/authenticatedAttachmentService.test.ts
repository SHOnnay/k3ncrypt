import { AttachmentService } from '../../service/src/attachments/service';
import { MemoryAttachmentDeliveryStore } from '../../service/src/attachments/delivery';
import { AuthenticatedAttachmentService } from './authenticatedAttachmentService';
import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext, type ConversationMembershipStore } from './authorizationContext';

const room = '11111111-1111-4111-8111-111111111111';
const base = (requestId: string, participantId = 'alice'): AuthenticatedContext => ({ sessionId: 'session-1', participantId, conversationId: room, permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'], requestId, createdAt: 1, expiresAt: Date.now() + 60_000, deviceTrust: { assertTrusted: async () => undefined } });
const members: ConversationMembershipStore = { isMember: async (conversationId, participantId) => conversationId === room && ['alice', 'bob'].includes(participantId) };

it('allows an authenticated owner upload and denies an unauthorized download', async () => {
  const access = new MemoryAttachmentAccessStore();
  const service = new AuthenticatedAttachmentService(new ConversationAuthorizationService(members, access), new AttachmentService(new MemoryAttachmentDeliveryStore()), access);
  const created = await service.createUpload(base('11111111-1111-4111-8111-111111111111'), { size: 1, chunkCount: 1, encryptedMetadata: { nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }, expiresAt: Date.now() + 10_000 });
  await expect(service.getChunks(base('22222222-2222-4222-8222-222222222222', 'mallory'), created.id, created.capability)).rejects.toThrow('Authorization failed');
});

it.each(['create', 'read', 'write', 'complete', 'delete'])('legacy %s cannot return a successful completion after trust revocation during storage', async operation => {
  const access = new MemoryAttachmentAccessStore();
  const store = new MemoryAttachmentDeliveryStore();
  const underlying = new AttachmentService(store);
  const service = new AuthenticatedAttachmentService(new ConversationAuthorizationService(members, access), underlying, access);
  const input = { size: 1, chunkCount: 1, encryptedMetadata: { nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }, expiresAt: Date.now() + 10000 };
  const created = await service.createUpload(base('33333333-3333-4333-8333-333333333333'), input);
  const chunk = { attachmentId: created.id, index: 0, total: 1, nonce: new Uint8Array(12), ciphertext: new Uint8Array(17) };
  await service.storeChunk(base('44444444-4444-4444-8444-444444444444'), created.id, created.capability, chunk);
  if (operation !== 'write') await service.completeUpload(base('55555555-5555-4555-8555-555555555555'), created.id, created.capability);
  let revoked = false, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const context = { ...base('66666666-6666-4666-8666-666666666666'), deviceTrust: { assertTrusted: async () => { if (revoked) throw new Error('Revoked'); } } };
  const method = operation === 'create' ? 'createUpload' : operation === 'read' ? 'getChunks' : operation === 'write' ? 'storeChunk' : operation === 'complete' ? 'completeUpload' : 'deleteAttachment';
  const original = underlying[method].bind(underlying) as (...args: any[]) => Promise<any>;
  jest.spyOn(underlying, method).mockImplementationOnce(async (...args: any[]) => { const result = await original(...args); entered(); await gate; return result; });
  const result = operation === 'create' ? service.createUpload(context, input) : operation === 'read' ? service.getChunks(context, created.id, created.capability) : operation === 'write' ? service.storeChunk(context, created.id, created.capability, chunk) : operation === 'complete' ? service.completeUpload(context, created.id, created.capability) : service.deleteAttachment(context, created.id, created.capability);
  await started; revoked = true; release();
  await expect(result).rejects.toThrow('Revoked');
});
