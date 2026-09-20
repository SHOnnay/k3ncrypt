import express from 'express';
import request from 'supertest';
import { AttachmentService } from '../../../service/src/attachments/service';
import { MemoryAttachmentDeliveryStore } from '../../../service/src/attachments/delivery';
import { AuthenticatedAttachmentService } from '../../security/authenticatedAttachmentService';
import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext, type ConversationMembershipStore } from '../../security/authorizationContext';
import { createAttachmentRouter } from './index';

const room = '11111111-1111-4111-8111-111111111111';
let requestNumber = 0;
const contextFor = (req: express.Request): AuthenticatedContext | undefined => {
    if (req.get('X-Test-Participant') === 'unknown') return undefined;
    requestNumber += 1;
    return { sessionId: 'test-session', participantId: req.get('X-Test-Participant') ?? 'alice', conversationId: req.get('X-Test-Conversation') ?? room, permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'], requestId: `22222222-2222-4222-8222-${String(requestNumber).padStart(12, '0')}`, createdAt: Date.now() - 1_000, expiresAt: Date.now() + 60_000, deviceTrust: { assertTrusted: async () => undefined } };
};

const setup = () => {
    const access = new MemoryAttachmentAccessStore();
    const members: ConversationMembershipStore = { isMember: async (conversationId, participantId) => conversationId === room && ['alice', 'bob'].includes(participantId) };
    const attachments = new AuthenticatedAttachmentService(new ConversationAuthorizationService(members, access), new AttachmentService(new MemoryAttachmentDeliveryStore()), access);
    const app = express(); app.use(express.json({ limit: '64kb' })); app.use('/attachments', createAttachmentRouter({ authenticate: async (req) => contextFor(req), attachments }));
    return app;
};

it('creates and completes an authorized encrypted upload', async () => {
    const app = setup();
    const created = await request(app).post('/attachments/create').send({ id: room, size: 1, chunkCount: 1, expiresAt: Date.now() + 10_000, encryptedMetadata: { nonce: Array(12).fill(1), ciphertext: Array(17).fill(2) } }).expect(201);
    await request(app).put(`/attachments/${created.body.id}/chunk`).set('X-K3ncrypt-Attachment-Capability', created.body.capability).set('X-K3ncrypt-Chunk-Index', '0').set('X-K3ncrypt-Chunk-Total', '1').set('X-K3ncrypt-Chunk-Nonce', 'AQEBAQEBAQEBAQEB').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(17, 2)).expect(204);
    await request(app).post(`/attachments/${created.body.id}/complete`).set('X-K3ncrypt-Attachment-Capability', created.body.capability).expect(204);
});

it('fails closed for missing context and wrong conversation', async () => {
    const app = setup();
    await request(app).post('/attachments/create').set('X-Test-Participant', 'unknown').send({}).expect(404, { error: 'Attachment unavailable' });
    await request(app).post('/attachments/create').set('X-Test-Conversation', '33333333-3333-4333-8333-333333333333').send({}).expect(404, { error: 'Attachment unavailable' });
});
