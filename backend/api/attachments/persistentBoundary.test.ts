import express from 'express';
import request from 'supertest';
import app from '../../../app';
import { encryptAttachment, generateAttachmentKey } from '../../../service/src/attachments/crypto';
import type { AttachmentId, EncryptedAttachmentChunk } from '../../../service/src/attachments/contracts';
import { PersistentAttachmentDeliveryStore, type PersistentAttachmentPersistence, type PersistentAttachmentRecord } from '../../../service/src/attachments/persistentDelivery';
import { AttachmentService } from '../../../service/src/attachments/service';
import { AuthenticatedAttachmentService } from '../../security/authenticatedAttachmentService';
import { ConversationAuthorizationService, MemoryAttachmentAccessStore, type AuthenticatedContext } from '../../security/authorizationContext';
import { createAttachmentRouter } from './index';

const room = '11111111-1111-4111-8111-111111111111';
const otherRoom = '33333333-3333-4333-8333-333333333333';
const plaintext = new TextEncoder().encode('private-file-content-only-on-client');

class DurableFixture implements PersistentAttachmentPersistence {
  records = new Map<string, PersistentAttachmentRecord>();
  chunkRecords = new Map<string, EncryptedAttachmentChunk>();
  metadata = {
    find: async (id: AttachmentId) => this.records.get(id),
    insert: async (record: PersistentAttachmentRecord) => { if (this.records.has(record.id)) throw new Error('duplicate'); this.records.set(record.id, structuredClone(record)); },
    updateStatus: async (id: AttachmentId, status: PersistentAttachmentRecord['status']) => { const record = this.records.get(id); if (!record) throw new Error('missing'); record.status = status; },
    expired: async (now: number) => [...this.records.values()].filter((record) => record.expiresAt <= now),
  };
  chunks = {
    find: async (id: AttachmentId, index: number) => this.chunkRecords.get(`${id}:${index}`),
    list: async (id: AttachmentId) => [...this.chunkRecords.values()].filter((chunk) => chunk.attachmentId === id),
    insert: async (chunk: EncryptedAttachmentChunk) => { const key = `${chunk.attachmentId}:${chunk.index}`; if (this.chunkRecords.has(key)) throw new Error('duplicate'); this.chunkRecords.set(key, structuredClone(chunk)); },
    delete: async (id: AttachmentId) => { for (const key of this.chunkRecords.keys()) if (key.startsWith(`${id}:`)) this.chunkRecords.delete(key); },
  };
}

it('does not mount test-authenticated attachment routes in the default app', async () => {
  await request(app).post('/api/attachments/create').send({}).expect(404);
});

it('keeps the authenticated route-to-persistent-store path ciphertext-only and fail-closed', async () => {
  const backing = new DurableFixture();
  const access = new MemoryAttachmentAccessStore();
  const membership = { isMember: async (conversationId: string, participantId: string) => conversationId === room && ['alice', 'bob'].includes(participantId) };
  const authorization = new ConversationAuthorizationService(membership, access);
  const attachments = new AuthenticatedAttachmentService(authorization, new AttachmentService(new PersistentAttachmentDeliveryStore(backing)), access);
  let sequence = 0;
  const authenticate = async (req: express.Request): Promise<AuthenticatedContext | undefined> => {
    const participantId = req.get('X-Test-Participant');
    if (!participantId) return undefined;
    sequence += 1;
    return { sessionId: 'test-session', participantId, conversationId: req.get('X-Test-Conversation') ?? room,
      permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'],
      requestId: `22222222-2222-4222-8222-${String(sequence).padStart(12, '0')}`,
      createdAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, deviceTrust: { assertTrusted: async () => undefined } };
  };
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/attachments', createAttachmentRouter({ authenticate, attachments }));

  const encrypted = await encryptAttachment(plaintext, generateAttachmentKey(), '44444444-4444-4444-8444-444444444444');
  const created = await request(testApp).post('/attachments/create').set('X-Test-Participant', 'alice').send({
    id: encrypted.reference.id, size: encrypted.reference.size, chunkCount: encrypted.reference.chunkCount,
    expiresAt: encrypted.reference.expiresAt,
    encryptedMetadata: { nonce: Array.from(encrypted.reference.encryptedMetadata.nonce), ciphertext: Array.from(encrypted.reference.encryptedMetadata.ciphertext) },
  }).expect(201);
  const id = created.body.id as string;
  const capability = created.body.capability as string;
  const chunk = encrypted.chunks[0];
  await request(testApp).put(`/attachments/${id}/chunk`).set('X-Test-Participant', 'alice')
    .set('X-K3ncrypt-Attachment-Capability', capability).set('X-K3ncrypt-Chunk-Index', '0')
    .set('X-K3ncrypt-Chunk-Total', '1').set('X-K3ncrypt-Chunk-Nonce', Buffer.from(chunk.nonce).toString('base64url'))
    .set('Content-Type', 'application/octet-stream').send(Buffer.from(chunk.ciphertext)).expect(204);
  await request(testApp).post(`/attachments/${id}/complete`).set('X-Test-Participant', 'alice')
    .set('X-K3ncrypt-Attachment-Capability', capability).expect(204);

  const stored = backing.records.get(id);
  expect(stored?.status).toBe('complete');
  expect(stored?.accessHash).not.toContain(capability);
  expect(JSON.stringify([...backing.records.values(), ...backing.chunkRecords.values()])).not.toContain(new TextDecoder().decode(plaintext));
  expect(Object.keys(stored ?? {})).not.toContain('key');
  expect(Object.keys(stored ?? {})).not.toContain('filename');
  await request(testApp).get(`/attachments/${id}/chunks`).set('X-Test-Participant', 'alice').set('X-K3ncrypt-Attachment-Capability', '0'.repeat(64)).expect(404, { error: 'Attachment unavailable' });
  await request(testApp).get(`/attachments/${id}/chunks`).set('X-Test-Participant', 'alice').set('X-Test-Conversation', otherRoom).set('X-K3ncrypt-Attachment-Capability', capability).expect(404, { error: 'Attachment unavailable' });
  const downloaded = await request(testApp).get(`/attachments/${id}/chunks`).set('X-Test-Participant', 'bob').set('X-K3ncrypt-Attachment-Capability', capability).expect(200);
  expect(downloaded.body).toHaveLength(1);
  expect(downloaded.body[0].ciphertext).toBe(Buffer.from(chunk.ciphertext).toString('base64url'));

  const restarted = new PersistentAttachmentDeliveryStore(backing);
  await expect(restarted.getChunks(id, `${room}:alice:${capability}`)).resolves.toHaveLength(1);
});
