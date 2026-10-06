import express, { type Request } from 'express';
import db from '../../db';
import { PREKEY_COLLECTION } from '../../db/const';
import { fingerprintVodozemacIdentity, type VodozemacPublicIdentity } from '../../../service/src/identity/vodozemacIdentity';
import { FILE_LIMITS, b64, type FileBinding, type WireObject } from '../../../service/src/files/protocol';
import { FileError, FileLedgerService, MongoFileLedgerPersistence } from '../../attachments/fileLedger';
import type { AuthenticatedContext } from '../../security/authorizationContext';
import type { DeviceOperation } from '../../security/deviceTrust';
import { authenticateAttachment } from './production';
export const createFileRouter = (authenticate: (req: Request, operation: DeviceOperation) => Promise<AuthenticatedContext | undefined>, service: () => FileLedgerService): express.Router => {
    const router = express.Router();
    const route = (operation: DeviceOperation, run: (auth: AuthenticatedContext, req: Request) => Promise<unknown>): express.RequestHandler => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            if (req.get('X-K3ncrypt-File-Version') !== '2') return void res.status(400).json({ failure: 'version' });
            const auth = await authenticate(req, operation); if (!auth) return void res.status(403).json({ failure: 'authorization' });
            res.json(await run(auth, req));
        } catch (e) {
            const category = e instanceof FileError ? e.category : 'storage';
            res.status(category === 'authorization' ? 403 : category === 'quota' ? 429 : category === 'expired' ? 410 : category === 'storage' ? 503 : 409).json({ failure: category });
        }
    };
    router.post('/create', route('attachment:create', (a, r) => service().create(a, r.body as { version: 2; binding: FileBinding; fileSize: number })));
    router.get('/:id', route('attachment:read', (a, r) => service().status(a, r.params.id)));
    router.put('/:id/manifest', route('attachment:write', (a, r) => service().put(a, r.params.id, 'manifest', r.body as WireObject)));
    router.put('/:id/chunks/:index', express.raw({ type: 'application/octet-stream', limit: FILE_LIMITS.MAX_CHUNK_SIZE + 16 }), route('attachment:write', (a, r) => {
        if (!Buffer.isBuffer(r.body)) throw new FileError('limits');
        return service().put(a, r.params.id, Number(r.params.index), { nonce: r.get('X-K3ncrypt-File-Nonce') ?? '', ciphertext: b64(r.body) });
    }));
    router.get('/:id/chunks/:index', route('attachment:read', (a, r) => service().chunk(a, r.params.id, Number(r.params.index))));
    router.post('/:id/complete', route('attachment:write', (a, r) => service().complete(a, r.params.id)));
    router.delete('/:id', route('attachment:delete', (a, r) => service().cancel(a, r.params.id)));
    return router;
};
let cached: FileLedgerService | undefined;
const production = (): FileLedgerService => {
    const database = db.getDatabase(); if (!database) throw new FileError('storage');
    if (!cached) {
        cached = new FileLedgerService(new MongoFileLedgerPersistence(database), async (conversation, participant) => {
            const published = await database.collection<{ bundle?: { identity?: VodozemacPublicIdentity } }>(PREKEY_COLLECTION).findOne({ channel: conversation, address: participant, expiresAt: { $gt: new Date() } });
            return published?.bundle?.identity ? fingerprintVodozemacIdentity(published.bundle.identity) : undefined;
        });
        // No sensitive fields in diagnostics. Persistent state is revisited after every backend restart.
        const timer = setInterval(() => { void cached?.cleanup().catch(() => undefined); }, 60_000); timer.unref();
        void cached.cleanup().catch(() => undefined);
    }
    return cached;
};
export const createProductionFileRouter = (): express.Router => createFileRouter(authenticateAttachment, production);
