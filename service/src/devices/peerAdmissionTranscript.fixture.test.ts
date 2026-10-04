import { readFileSync } from 'fs';
import { resolve } from 'path';

// Independent test-only projection. Never export or import into runtime.
// This tests unsigned byte framing, not authentication or eligibility.
interface TranscriptInput {
    conversationId: string;
    initiatorDeviceId: string;
    initiatorIdentityReference: string;
    responderDeviceId: string;
    responderIdentityReference: string;
    initiatorNonceHex: string;
    responderNonceHex: string;
    initiatorOfferedControlVersions: number[];
    responderOfferedControlVersions: number[];
    selectedControlVersion: number;
    downgradeOutcome: string;
    transportBinding: { kind: string; fingerprintAlgorithm: string; initiatorFingerprintHex: string; responderFingerprintHex: string };
}
interface FixtureVector { name: string; input: TranscriptInput; initiatorPayloadHex: string; responderPayloadHex: string; }
interface ReviewFixture { status: string; productionEligible: boolean; signatureOutputs: null; vectors: FixtureVector[]; }
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../..', 'protocol-fixtures/v1/peer-admission-transcript-review.json'), 'utf8')) as ReviewFixture;
const u32 = (value: number): Buffer => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Invalid U32');
    const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes;
};
const lp = (bytes: Buffer): Buffer => Buffer.concat([u32(bytes.length), bytes]);
const text = (value: string): Buffer => {
    // Buffer/TextEncoder would silently replace an isolated UTF-16 surrogate.
    for (let i = 0; i < value.length; i += 1) {
        const unit = value.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Invalid Unicode');
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('Invalid Unicode');
    }
    return lp(Buffer.from(value, 'utf8'));
};
const hex = (value: string): Buffer => {
    if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Invalid hex');
    return lp(Buffer.from(value, 'hex'));
};
const versions = (values: number[]): Buffer => {
    if (!values.length || values.some((v, i) => !Number.isInteger(v) || v <= 0 || (i > 0 && v <= values[i - 1]))) throw new Error('Noncanonical list');
    return Buffer.concat([u32(values.length), ...values.map(u32)]);
};
const encode = (value: TranscriptInput, role: 'initiator' | 'responder'): Buffer => {
    const binding = value.transportBinding;
    const bound = Buffer.concat([text(binding.kind), text(binding.fingerprintAlgorithm),
        hex(binding.initiatorFingerprintHex), hex(binding.responderFingerprintHex)]);
    return Buffer.concat([
        text('k3ncrypt/peer-admission/v1'), u32(1), text(role),
        text(value.conversationId), text(value.initiatorDeviceId), text(value.initiatorIdentityReference),
        text(value.responderDeviceId), text(value.responderIdentityReference), text('initiator'), text('responder'),
        hex(value.initiatorNonceHex), hex(value.responderNonceHex),
        versions(value.initiatorOfferedControlVersions), versions(value.responderOfferedControlVersions),
        u32(value.selectedControlVersion), text(value.downgradeOutcome), lp(bound),
    ]);
};

describe('PeerAdmission review-only unsigned framing', () => {
    it('cannot be mistaken for approved or signed admission evidence', () => {
        expect(fixture.status).toBe('REVIEW_ONLY_NOT_APPROVED');
        expect(fixture.productionEligible).toBe(false);
        expect(fixture.signatureOutputs).toBeNull();
    });
    it.each(fixture.vectors)('matches both frozen signer payloads: $name', (vector: FixtureVector) => {
        expect(encode(vector.input, 'initiator').toString('hex')).toBe(vector.initiatorPayloadHex);
        expect(encode(vector.input, 'responder').toString('hex')).toBe(vector.responderPayloadHex);
        expect(vector.initiatorPayloadHex).not.toBe(vector.responderPayloadHex);
    });
    it('changes every bound mutation relative to the normal projection', () => {
        const baseline = fixture.vectors[0].initiatorPayloadHex;
        for (const vector of fixture.vectors.slice(1)) expect(vector.initiatorPayloadHex).not.toBe(baseline);
    });
    it('rejects replacement Unicode, invalid hex and ambiguous version lists', () => {
        expect(() => text('\ud800')).toThrow('Unicode');
        expect(() => text('\udc00')).toThrow('Unicode');
        expect(() => hex('a')).toThrow('hex');
        expect(() => versions([2, 1])).toThrow('list');
        expect(() => versions([1, 1])).toThrow('list');
        expect(() => u32(-1)).toThrow('U32');
    });
});
