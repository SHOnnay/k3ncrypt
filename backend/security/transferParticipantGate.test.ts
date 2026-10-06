import { encryptAttachment, generateAttachmentKey } from '../../service/src/attachments/crypto';
import { AttachmentService, type CreateAttachmentUpload } from '../../service/src/attachments/service';
import { MemoryAttachmentDeliveryStore } from '../../service/src/attachments/delivery';
import { AuthenticatedAttachmentService } from './authenticatedAttachmentService';
import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext } from './authorizationContext';

const room = '11111111-1111-4111-8111-111111111111';
const rejects = async (action: () => Promise<unknown>): Promise<boolean> => {
    try { await action(); return false; } catch { return true; }
};
const fixture = async () => {
    let sequence = 0;
    const context = (participant: string, identityOverride?: string, conversationId = room): AuthenticatedContext => {
        const participantId = participant === 'alice' ? '33333333-3333-4333-8333-333333333333' : participant === 'bob' ? '44444444-4444-4444-8444-444444444444' : '55555555-5555-4555-8555-555555555555';
        const identityReference = identityOverride ?? (participantId === '33333333-3333-4333-8333-333333333333' ? 'K3 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAA' : participantId === '44444444-4444-4444-8444-444444444444' ? 'K3 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEE' : 'K3 MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMM');
        return { sessionId: 'test-only-session', participantId, conversationId,
            permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'], identityReference,
            requestId: `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`,
            createdAt: Date.now() - 1000, expiresAt: Date.now() + 30_000, deviceTrust: { assertTrusted: async () => undefined } };
    };
    const access = new MemoryAttachmentAccessStore();
    // Production currently admits any valid published pre-key address for this room.
    const membership = { isMember: async (conversationId: string, participantId: string) => conversationId === room && ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'].includes(participantId), identityReference: async (_conversationId: string, participantId: string) => participantId === '44444444-4444-4444-8444-444444444444' ? 'K3 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEE' : participantId === '33333333-3333-4333-8333-333333333333' ? 'K3 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAA' : 'K3 MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMM' };
    const service = new AuthenticatedAttachmentService(new ConversationAuthorizationService(membership, access), new AttachmentService(new MemoryAttachmentDeliveryStore()), access);
    const encrypted = await encryptAttachment(new Uint8Array([1, 2, 3]), generateAttachmentKey());
    const input: CreateAttachmentUpload = { ...encrypted.reference, recipientParticipantId: '44444444-4444-4444-8444-444444444444', recipientIdentityReference: 'K3 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEE' };
    const created = await service.createUpload(context('alice'), input);
    return { context, service, created, encrypted };
};

it('restricts a transfer write to its owner, even when another room publisher knows its capability', async () => {
    const { context, service, created, encrypted } = await fixture();
    expect(await rejects(() => service.storeChunk(context('mallory'), created.id, created.capability, encrypted.chunks[0]))).toBe(true);
});

it('restricts destructive transfer operations to the owner', async () => {
    const { context, service, created } = await fixture();
    expect(await rejects(() => service.deleteAttachment(context('bob'), created.id, created.capability))).toBe(true);
});

it('rejects reads by a room publisher outside the intended sender/receiver pair', async () => {
    const { context, service, created, encrypted } = await fixture();
    await service.storeChunk(context('alice'), created.id, created.capability, encrypted.chunks[0]);
    await service.completeUpload(context('alice'), created.id, created.capability);
    expect(await rejects(() => service.getChunks(context('mallory'), created.id, created.capability))).toBe(true);
});

it('allows only the pinned intended recipient to read and rejects identity replacement', async () => {
    const { context, service, created, encrypted } = await fixture();
    await service.storeChunk(context('alice'), created.id, created.capability, encrypted.chunks[0]);
    await service.completeUpload(context('alice'), created.id, created.capability);
    await expect(service.getChunks(context('bob'), created.id, created.capability)).resolves.toHaveLength(1);
    expect(await rejects(() => service.getChunks(context('bob', 'K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ'), created.id, created.capability))).toBe(true);
    expect(await rejects(() => service.storeChunk(context('alice', 'K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ'), created.id, created.capability, encrypted.chunks[0]))).toBe(true);
});

it('rejects conversation substitution even when the caller is a room member and has the capability', async () => {
    const { context, service, created } = await fixture();
    expect(await rejects(() => service.getChunks(context('bob', undefined, '66666666-6666-4666-8666-666666666666'), created.id, created.capability))).toBe(true);
});

it('rejects a recipient identity that differs from the server-published pinned identity at creation', async () => {
    const { context, service, encrypted } = await fixture();
    const wrongRecipient: CreateAttachmentUpload = { ...encrypted.reference, recipientParticipantId: '44444444-4444-4444-8444-444444444444', recipientIdentityReference: 'K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ' };
    expect(await rejects(() => service.createUpload(context('alice'), wrongRecipient))).toBe(true);
});
