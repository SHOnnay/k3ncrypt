import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1', name), 'utf8'));
const lengthPrefix = (bytes: Buffer): Buffer => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(bytes.length);
    return Buffer.concat([prefix, bytes]);
};

describe('Phase 0 shared connectivity fixtures (no production integration)', () => {
    test('proposed envelope identity vectors are stable across UTF-8 and conversation domains', () => {
        const document = fixture('envelope-identity.json');
        expect(document.version).toBe(1);
        expect(document.vectors).toHaveLength(3);
        for (const vector of document.vectors) {
            const digest = createHash('sha256').update(Buffer.concat([
                Buffer.from(document.domain, 'utf8'),
                lengthPrefix(Buffer.from(vector.conversationId, 'utf8')),
                lengthPrefix(Buffer.from(vector.olmMessage, 'utf8')),
            ])).digest('hex');
            expect(digest).toBe(vector.expectedHex);
        }
        expect(document.vectors[0].olmMessage).toBe(document.vectors[2].olmMessage);
        expect(document.vectors[0].expectedHex).not.toBe(document.vectors[2].expectedHex);
    });

    test('proposed path gate rejects each individual missing prerequisite', () => {
        const document = fixture('path-eligibility.json');
        expect(document.version).toBe(1);
        expect(document.cases).toHaveLength(6);
        for (const item of document.cases) {
            const eligible = item.verified && item.identityUnchanged && item.deviceAuthorized &&
                item.freshnessValid && item.featureNegotiated;
            expect(eligible).toBe(item.eligible);
        }
    });
});
