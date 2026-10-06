import express from 'express';
import { randomUUID } from 'crypto';
import { createFileRouter } from './files';
import { FileLedgerService, type FileLedger, type FileLedgerPersistence } from '../../attachments/fileLedger';
import type { AuthenticatedContext } from '../../security/authorizationContext';
const request: (app: express.Express) => { post: (url: string) => RequestTest; get: (url: string) => RequestTest; put: (url: string) => RequestTest; delete: (url: string) => RequestTest } = require('supertest');
interface RequestTest extends PromiseLike<{ status: number; body: Record<string, unknown> }> { set(name: string, value: string): RequestTest; send(body: unknown): RequestTest; }
const a = randomUUID(), b = randomUUID(), conversationId = randomUUID(); const fp = (c: string): string => 'K3 ' + Array(10).fill(c.repeat(4)).join(' ') + ' ' + c.repeat(3);
const auth: AuthenticatedContext = { participantId: a, accountIdentityReference: 'alice', identityReference: fp('A'), sessionId: 'session', conversationId, requestId: randomUUID(), createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, deviceTrust: { assertTrusted: async () => {} }, permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'] };
const records = new Map<string, FileLedger>(); const persistence: FileLedgerPersistence = { object: async () => undefined, read: async id => records.get(id), locate: async id => [...records.values()].find(v => v.transfers.some(f => f.context.transferId === id)), replace: async (before, after) => { if (records.get(after._id)?.revision !== before?.revision) return false; records.set(after._id, after); return true; }, accounts: async function* () { for (const id of records.keys()) yield id; } };
const service = new FileLedgerService(persistence, async (_c, p) => p === a ? fp('A') : p === b ? fp('B') : undefined);
const app = express(); app.use(express.json({ limit: '64kb' })); const operations: string[] = [];
app.use('/files', createFileRouter(async (r, op) => { operations.push(op); return r.get('Authorization') === 'test-only' ? { ...auth, requestId: randomUUID() } : undefined; }, () => service));
test('all V2 endpoints require explicit version and proof authentication; unsupported/stripped version fail', async () => {
    for (const version of ['', '1', '3']) expect((await request(app).post('/files/create').set('X-K3ncrypt-File-Version', version).send({})).status).toBe(400);
    for (const path of ['/files/create', '/files/' + randomUUID() + '/complete']) expect((await request(app).post(path).set('X-K3ncrypt-File-Version', '2').send({})).status).toBe(403);
    expect((await request(app).get('/files/' + randomUUID()).set('X-K3ncrypt-File-Version', '2')).status).toBe(403);
    const created = await request(app).post('/files/create').set('X-K3ncrypt-File-Version', '2').set('Authorization', 'test-only').send({ version: 2, binding: { conversationId, senderParticipantId: a, recipientParticipantId: b, senderIdentityReference: fp('A'), recipientIdentityReference: fp('B') }, fileSize: 1 }); expect(created.status).toBe(200);
    const id = (created.body.context as { transferId: string }).transferId;
    expect((await request(app).put(`/files/${id}/chunks/0`).set('X-K3ncrypt-File-Version', '2').send(Buffer.alloc(17))).status).toBe(403);
    expect((await request(app).delete(`/files/${id}`).set('X-K3ncrypt-File-Version', '2')).status).toBe(403);
    expect(operations).toContain('attachment:create'); expect(operations).toContain('attachment:write'); expect(operations).toContain('attachment:read'); expect(operations).toContain('attachment:delete');
});
