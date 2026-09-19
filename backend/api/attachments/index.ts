import bodyParser from 'body-parser';
import express, { type Request } from 'express';
import type { EncryptedAttachmentChunk } from '../../../service/src/attachments/contracts';
import type { AuthenticatedContext } from '../../security/authorizationContext';
import { AuthenticatedAttachmentService } from '../../security/authenticatedAttachmentService';

export interface AttachmentRouteDependencies { authenticate(request: Request): Promise<AuthenticatedContext | undefined>; attachments: AuthenticatedAttachmentService; }
const unavailable = (res: express.Response): express.Response => res.status(404).json({ error: 'Attachment unavailable' });
const bytes = (value: unknown): Uint8Array | undefined => Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255) ? new Uint8Array(value) : undefined;
const capability = (req: Request): string => req.get('X-K3ncrypt-Attachment-Capability') ?? '';

/** Creates routes only when the host supplies real session authentication and a persistent service. */
export const createAttachmentRouter = (dependencies: AttachmentRouteDependencies): express.Router => {
    const router = express.Router({ mergeParams: true });
    router.post('/create', async (req, res) => {
        try {
            const auth = await dependencies.authenticate(req); if (!auth) return unavailable(res);
            const body = req.body ?? {};
            const encryptedMetadata = body.encryptedMetadata;
            const nonce = bytes(encryptedMetadata?.nonce); const ciphertext = bytes(encryptedMetadata?.ciphertext);
            if (Object.keys(body).some((key) => !['id', 'size', 'chunkCount', 'encryptedMetadata', 'expiresAt'].includes(key)) || !Number.isSafeInteger(body.size) || !Number.isSafeInteger(body.chunkCount) || !Number.isSafeInteger(body.expiresAt) || !nonce || !ciphertext) return unavailable(res);
            const created = await dependencies.attachments.createUpload(auth, { id: typeof body.id === 'string' ? body.id : undefined, size: body.size, chunkCount: body.chunkCount, encryptedMetadata: { nonce, ciphertext }, expiresAt: body.expiresAt });
            return res.status(201).json(created);
        } catch { return unavailable(res); }
    });
    router.put('/:id/chunk', bodyParser.raw({ type: 'application/octet-stream', limit: '300kb' }), async (req, res) => {
        try {
            const auth = await dependencies.authenticate(req); if (!auth || typeof req.params.id !== 'string' || !Buffer.isBuffer(req.body)) return unavailable(res);
            const index = Number(req.get('X-K3ncrypt-Chunk-Index')); const total = Number(req.get('X-K3ncrypt-Chunk-Total')); const nonceText = req.get('X-K3ncrypt-Chunk-Nonce') ?? '';
            const nonce = Buffer.from(nonceText, 'base64url');
            if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || nonce.length !== 12 || req.body.byteLength < 17) return unavailable(res);
            const chunk: EncryptedAttachmentChunk = { attachmentId: req.params.id, index, total, nonce: new Uint8Array(nonce), ciphertext: new Uint8Array(req.body) };
            await dependencies.attachments.storeChunk(auth, req.params.id, capability(req), chunk);
            return res.status(204).send();
        } catch { return unavailable(res); }
    });
    router.post('/:id/complete', async (req, res) => { try { const auth = await dependencies.authenticate(req); if (!auth || typeof req.params.id !== 'string') return unavailable(res); await dependencies.attachments.completeUpload(auth, req.params.id, capability(req)); return res.status(204).send(); } catch { return unavailable(res); } });
    router.get('/:id/chunks', async (req, res) => { try { const auth = await dependencies.authenticate(req); if (!auth || typeof req.params.id !== 'string') return unavailable(res); const chunks = await dependencies.attachments.getChunks(auth, req.params.id, capability(req)); return res.json(chunks.map((chunk) => ({ attachmentId: chunk.attachmentId, index: chunk.index, total: chunk.total, nonce: Buffer.from(chunk.nonce).toString('base64url'), ciphertext: Buffer.from(chunk.ciphertext).toString('base64url') }))); } catch { return unavailable(res); } });
    router.delete('/:id', async (req, res) => { try { const auth = await dependencies.authenticate(req); if (!auth || typeof req.params.id !== 'string') return unavailable(res); await dependencies.attachments.deleteAttachment(auth, req.params.id, capability(req)); return res.status(204).send(); } catch { return unavailable(res); } });
    return router;
};
