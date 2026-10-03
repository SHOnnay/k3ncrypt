import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EncryptedEnvelope } from '../core/contracts';
import { envelopeId, envelopeIdForEnvelope, validatedOlmMessage } from './envelopeIdentity';

type Fixture = { vectors: Array<{ conversationId: string; olmMessage: string; expectedHex: string }> };
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/envelope-identity.json'), 'utf8')) as Fixture;
const envelope = (olmMessage: string): EncryptedEnvelope => ({ version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage } });

describe('stable envelope identity v1', () => {
    it('matches the existing cross-platform fixture exactly', async () => {
        for (const vector of fixture.vectors) {
            await expect(envelopeId(vector.conversationId, vector.olmMessage)).resolves.toBe(`v1:${vector.expectedHex}`);
        }
    });

    it('uses the validated ciphertext string independent of envelope JSON spacing and key order', async () => {
        const wire = '/"\\☃';
        const compact = JSON.parse(`{"version":2,"strategy":"vodozemac-olm-v1","data":{"version":1,"olmMessage":${JSON.stringify(wire)}}}`) as EncryptedEnvelope;
        const spacedAndReordered = JSON.parse(`{ "data" : { "olmMessage" : ${JSON.stringify(wire)}, "version" : 1 }, "strategy" : "vodozemac-olm-v1", "version" : 2 }`) as EncryptedEnvelope;
        expect(validatedOlmMessage(compact)).toBe(wire);
        expect(validatedOlmMessage(spacedAndReordered)).toBe(wire);
        await expect(envelopeIdForEnvelope('conversation-ñ-東京', compact)).resolves.toBe(await envelopeIdForEnvelope('conversation-ñ-東京', spacedAndReordered));
    });

    it('binds the ID to the conversation and exact ciphertext', async () => {
        const base = await envelopeId('room-a', 'ciphertext');
        expect(await envelopeId('room-b', 'ciphertext')).not.toBe(base);
        expect(await envelopeId('room-a', 'ciphertext changed')).not.toBe(base);
        expect(await envelopeId('room-a', 'ciphertext')).toBe(base);
    });

    it('handles long ciphertext inputs within the existing envelope bound', async () => {
        const long = 'x'.repeat(192 * 1024);
        expect(await envelopeId('long-room', long)).toMatch(/^v1:[0-9a-f]{64}$/);
    });

    it('rejects malformed UTF-16 instead of silently replacing it across platforms', async () => {
        await expect(envelopeId('room', '\ud800')).rejects.toThrow('valid Unicode');
        await expect(envelopeId('\udfff', 'ciphertext')).rejects.toThrow('valid Unicode');
    });

    it('rejects malformed or unsupported envelopes before extracting ciphertext', async () => {
        expect(() => validatedOlmMessage({ ...envelope('x'), data: { version: 1, olmMessage: 'x', unexpected: true } })).toThrow('Malformed modern message');
        expect(() => validatedOlmMessage({ ...envelope('x'), version: 1 })).toThrow('Unsupported modern message');
    });
});
