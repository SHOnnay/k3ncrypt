import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EncryptedEnvelope } from '../core/contracts';
import { envelopeId, envelopeIdForEnvelope, validatedOlmMessage } from './envelopeIdentity';

type Fixture = { vectors: Array<{ conversationId: string; olmMessage: string; expectedHex: string }> };
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/envelope-identity.json'), 'utf8')) as Fixture;
const envelope = (olmMessage: string): EncryptedEnvelope => ({ version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage } });

describe('stable envelope identity v1 characterization', () => {
    it('matches the shared cross-platform fixture', async () => {
        for (const vector of fixture.vectors) {
            await expect(envelopeId(vector.conversationId, vector.olmMessage)).resolves.toBe(`v1:${vector.expectedHex}`);
        }
    });

    it('is invariant to outer JSON whitespace/key order and binds conversation plus exact ciphertext', async () => {
        const compact = JSON.parse(`{"version":2,"strategy":"vodozemac-olm-v1","data":{"version":1,"olmMessage":${JSON.stringify('/"\\☃')}}}`) as EncryptedEnvelope;
        const spaced = JSON.parse(`{ "data" : { "olmMessage" : ${JSON.stringify('/"\\☃')}, "version" : 1 }, "strategy" : "vodozemac-olm-v1", "version" : 2 }`) as EncryptedEnvelope;
        expect(validatedOlmMessage(compact)).toBe('/"\\☃');
        await expect(envelopeIdForEnvelope('conversation-ñ-東京', compact)).resolves.toBe(await envelopeIdForEnvelope('conversation-ñ-東京', spaced));
        const base = await envelopeId('room-a', 'ciphertext');
        expect(await envelopeId('room-b', 'ciphertext')).not.toBe(base);
        expect(await envelopeId('room-a', 'ciphertext changed')).not.toBe(base);
    });

    it('rejects malformed encodings and envelope shapes before computing an ID', async () => {
        await expect(envelopeId('room', '\ud800')).rejects.toThrow('valid Unicode');
        expect(() => validatedOlmMessage({ ...envelope('ciphertext'), data: { version: 1, olmMessage: 'ciphertext', extra: true } })).toThrow('Malformed modern message');
        expect(() => validatedOlmMessage({ ...envelope('ciphertext'), version: 1 })).toThrow('Unsupported modern message');
    });
});
