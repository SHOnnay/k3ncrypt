import { randomUUID } from 'crypto';
import { FILE_LIMITS as L, validateFileContext } from './protocol';
import { decodeAttachmentManifest, encodeAttachmentManifest } from '../attachments/portableManifest';
const fp = (c: string) => 'K3 ' + Array(10).fill(c.repeat(4)).join(' ') + ' ' + c.repeat(3);
const context = { transferId: randomUUID(), conversationId: randomUUID(), senderParticipantId: randomUUID(), recipientParticipantId: randomUUID(), senderIdentityReference: fp('A'), recipientIdentityReference: fp('B'), fileSize: L.MAX_FILE_SIZE, chunkSize: L.MAX_CHUNK_SIZE, chunkCount: L.MAX_CHUNK_COUNT };
test('safe file/chunk/object geometry is explicit: 8 MiB / 256 KiB = 32 chunks plus one manifest', () => {
    expect(() => validateFileContext(context)).not.toThrow();
    for (const mutation of [{ fileSize: L.MAX_FILE_SIZE + 1, chunkCount: 33 }, { chunkSize: L.MAX_CHUNK_SIZE + 1 }, { chunkCount: 33 }, { chunkCount: 0 }, { chunkIndex: 0 }]) expect(() => validateFileContext({ ...context, ...mutation })).toThrow();
});
test('traversal/absolute/control/reserved/extreme filenames and executable MIME claims are sanitized as metadata', () => {
    for (const filename of ['../secret.txt', '..\\secret.txt', '/absolute', 'C:\\absolute', '\0\nfile', '', 'CON.txt', 'NUL', '\u202eevil.html']) {
        const m = decodeAttachmentManifest(encodeAttachmentManifest({ fileSize: 1, chunkSize: L.MAX_CHUNK_SIZE, chunkCount: 1, createdAt: 1, expiresAt: 1 + L.TRANSFER_EXPIRY, filename, mimeType: 'text/html;script=evil' }));
        expect(m.filename).not.toMatch(/[\\/\u0000-\u001f\u007f\u202e]/u); expect(m.filename).not.toMatch(/^\./); expect([...m.filename].length).toBeLessThanOrEqual(120); expect(m.filename.length).toBeGreaterThan(0); expect(m.mimeType).toBe('application/octet-stream');
    }
    expect(() => encodeAttachmentManifest({ fileSize: 1, chunkSize: L.MAX_CHUNK_SIZE, chunkCount: 1, createdAt: 1, expiresAt: 1 + L.TRANSFER_EXPIRY, filename: 'x'.repeat(4096), mimeType: 'text/plain' })).toThrow();
});
