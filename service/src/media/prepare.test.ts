import { decryptAttachment } from '../attachments';
import { prepareEncryptedMedia } from './prepare';

describe('encrypted media preparation', () => {
    it('encrypts supported image/file bytes without retaining names or paths', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const prepared = await prepareEncryptedMedia('image', bytes, 'image/png');
        expect(prepared.attachment).not.toHaveProperty('filename');
        expect(await decryptAttachment(prepared.attachment, prepared.chunks, prepared.key)).toEqual(bytes);
    });
    it('rejects unsupported types and oversized media', async () => {
        await expect(prepareEncryptedMedia('image', new Uint8Array([1]), 'image/svg+xml')).rejects.toThrow('Unsupported');
        await expect(prepareEncryptedMedia('file', new Uint8Array(), 'application/pdf')).rejects.toThrow('size');
    });
});
