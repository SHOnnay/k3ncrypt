import { createEncryptedMediaMessage, parseEncryptedMediaMessage, serializeEncryptedMediaMessage } from './message';
import { prepareEncryptedMedia } from './prepare';

it('creates a reference that travels through the existing E2EE message as opaque JSON', async () => {
    const media = await prepareEncryptedMedia('image', new Uint8Array([1, 2]), 'image/png');
    const parsed = parseEncryptedMediaMessage(serializeEncryptedMediaMessage(createEncryptedMediaMessage(media)));
    expect(parsed?.attachmentId).toBe(media.attachment.id);
    expect(parsed?.attachmentKey).toHaveLength(32);
    expect(JSON.stringify(parsed)).not.toContain('filename');
});

it('rejects malformed media references', () => {
    expect(() => parseEncryptedMediaMessage('k3ncrypt-media-v1:{"version":1,"kind":"image"}')).toThrow('invalid');
});
