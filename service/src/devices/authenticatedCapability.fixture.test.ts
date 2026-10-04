import { readFileSync } from 'fs';
import { resolve } from 'path';

// Unsigned review projection in test source only. No production exports.
interface Capability { id: string; versions: number[]; }
interface Offer { offerVersion: number; admissionVersions: number[]; negotiationVersions: number[]; controlVersions: number[]; capabilities: Capability[]; requiredIds: string[]; }
interface Selected { id: string; version: number; }
interface Input { preferenceProfileId: string; conversationId: string; initiatorDeviceId: string; initiatorIdentityReference: string; responderDeviceId: string; responderIdentityReference: string; initiatorNonceHex: string; responderNonceHex: string; transportBindingHex: string; initiatorOffer: Offer; responderOffer: Offer; selectedControlVersion: number; selectedCapabilities: Selected[]; }
interface Vector { name: string; input: Input; expectedOutcome: string; canonicalEquivalentToBaseline: boolean; initiatorPayloadHex: string; responderPayloadHex: string; }
interface Fixture { status: string; productionEligible: boolean; signatureOutputs: null; profile: { id: string; controlPreference: number[]; requiredIds: string[]; semanticVersion: number }; vectors: Vector[]; }
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../..', 'protocol-fixtures/v1/authenticated-capability-review.json'), 'utf8')) as Fixture;
const u32 = (n: number): Buffer => {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('U32');
    const b = Buffer.alloc(4); b.writeUInt32BE(n); return b;
};
const lp = (b: Buffer): Buffer => Buffer.concat([u32(b.length), b]);
const text = (s: string): Buffer => {
    for (let i = 0; i < s.length; i += 1) {
        const n = s.charCodeAt(i);
        if (n >= 0xd800 && n <= 0xdbff) {
            const next = s.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unicode');
        } else if (n >= 0xdc00 && n <= 0xdfff) throw new Error('Unicode');
    }
    return lp(Buffer.from(s, 'utf8'));
};
const hex = (s: string): Buffer => {
    if (!/^(?:[0-9a-f]{2})+$/.test(s)) throw new Error('hex');
    return lp(Buffer.from(s, 'hex'));
};
const unique = <T>(a: T[]): T[] => {
    if (new Set(a).size !== a.length) throw new Error('duplicate');
    return a;
};
const id = (s: string): string => {
    if (!/^[a-z0-9/-]+$/.test(s)) throw new Error('id');
    return s;
};
const versions = (a: number[]): Buffer => {
    if (!a.length || a.some(n => !Number.isInteger(n) || n <= 0 || n > 0xffffffff)) throw new Error('versions');
    const sorted = unique([...a]).sort((a, b) => a - b);
    return Buffer.concat([u32(sorted.length), ...sorted.map(u32)]);
};
const offer = (o: Offer): Buffer => {
    if (o.offerVersion !== 1 || Object.keys(o).sort().join(',') !== ['offerVersion', 'admissionVersions', 'negotiationVersions', 'controlVersions', 'capabilities', 'requiredIds'].sort().join(',')) throw new Error('schema');
    unique(o.capabilities.map(c => id(c.id))); unique(o.requiredIds.map(id));
    for (const c of o.capabilities) {
        if (Object.keys(c).sort().join(',') !== 'id,versions') throw new Error('schema');
    }
    if (o.requiredIds.some(i => !o.capabilities.some(c => c.id === i))) throw new Error('missing');
    const caps = [...o.capabilities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return Buffer.concat([u32(1), versions(o.admissionVersions), versions(o.negotiationVersions), versions(o.controlVersions), u32(caps.length), ...caps.map(c => Buffer.concat([text(c.id), versions(c.versions)])), u32(o.requiredIds.length), ...[...o.requiredIds].sort().map(text)]);
};
const select = (a: Offer, b: Offer): { control: number; capabilities: Selected[] } => {
    offer(a); offer(b);
    if ([a, b].some(o => !o.admissionVersions.includes(1) || !o.negotiationVersions.includes(1))) throw new Error('BOOTSTRAP');
    if ([...a.requiredIds, ...b.requiredIds].some(i => !fixture.profile.requiredIds.includes(i))) throw new Error('UNKNOWN_REQUIRED');
    const control = fixture.profile.controlPreference.find(v => a.controlVersions.includes(v) && b.controlVersions.includes(v));
    if (control === undefined) throw new Error('NO_COMMON');
    const capabilities = fixture.profile.requiredIds.map(i => {
        if ([a, b].some(o => !o.capabilities.find(c => c.id === i)?.versions.includes(1))) throw new Error('NO_COMMON');
        return { id: i, version: 1 };
    });
    return { control, capabilities };
};
const encode = (x: Input, role: 'initiator' | 'responder'): Buffer => {
    const caps = [...x.selectedCapabilities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    unique(caps.map(c => id(c.id)));
    return Buffer.concat([text('k3ncrypt/peer-admission/a1-review'), u32(1), text(role), ...['preferenceProfileId', 'conversationId', 'initiatorDeviceId', 'initiatorIdentityReference', 'responderDeviceId', 'responderIdentityReference'].map(k => text(x[k as keyof Input] as string)), text('initiator'), text('responder'), hex(x.initiatorNonceHex), hex(x.responderNonceHex), lp(offer(x.initiatorOffer)), lp(offer(x.responderOffer)), u32(x.selectedControlVersion), u32(caps.length), ...caps.map(c => Buffer.concat([text(c.id), u32(c.version)])), hex(x.transportBindingHex)]);
};
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const baseline = fixture.vectors[0].input;
const evaluate = (v: Vector): string => {
    const x = v.input;
    const contextKeys: (keyof Input)[] = ['preferenceProfileId', 'conversationId', 'initiatorDeviceId', 'initiatorIdentityReference', 'responderDeviceId', 'responderIdentityReference', 'initiatorNonceHex', 'responderNonceHex', 'transportBindingHex'];
    if (contextKeys.some(k => x[k] !== baseline[k])) return 'CONTEXT_MISMATCH';
    if (!offer(x.initiatorOffer).equals(offer(baseline.initiatorOffer))) return 'OWN_OFFER_MISMATCH';
    try {
        const result = select(x.initiatorOffer, x.responderOffer);
        return result.control === x.selectedControlVersion && JSON.stringify(result.capabilities) === JSON.stringify(x.selectedCapabilities) ? 'ACCEPT' : 'RESULT_MISMATCH';
    } catch (error) { return (error as Error).message; }
};
describe('A1 unsigned capability review projection', () => {
    it('is explicitly unsigned and unapproved', () => {
        expect(fixture.status).toBe('REVIEW_ONLY_NOT_APPROVED'); expect(fixture.productionEligible).toBe(false); expect(fixture.signatureOutputs).toBeNull();
    });
    it.each(fixture.vectors)('matches independent frozen bytes and local checks: $name', (v: Vector) => {
        expect(encode(v.input, 'initiator').toString('hex')).toBe(v.initiatorPayloadHex);
        expect(encode(v.input, 'responder').toString('hex')).toBe(v.responderPayloadHex);
        expect(v.initiatorPayloadHex).not.toBe(v.responderPayloadHex);
        expect(evaluate(v)).toBe(v.expectedOutcome);
        if (v.canonicalEquivalentToBaseline) expect(v.initiatorPayloadHex).toBe(fixture.vectors[0].initiatorPayloadHex);
        else if (v !== fixture.vectors[0]) expect(v.initiatorPayloadHex).not.toBe(fixture.vectors[0].initiatorPayloadHex);
    });
    it('selects symmetrically by reviewed synthetic preference, never integer maximum', () => {
        expect(select(baseline.initiatorOffer, baseline.responderOffer).control).toBe(1);
        for (const v of fixture.vectors.filter(v => v.expectedOutcome === 'ACCEPT')) expect(select(v.input.initiatorOffer, v.input.responderOffer)).toEqual(select(v.input.responderOffer, v.input.initiatorOffer));
    });
    it('rejects duplicates, schema ambiguity, malformed values and missing prerequisites', () => {
        for (const mutate of [
            (o: Offer) => o.controlVersions.push(1),
            (o: Offer) => o.capabilities.push(copy(o.capabilities[0])),
            (o: Offer) => o.requiredIds.push(o.requiredIds[0]),
            (o: Offer) => { o.offerVersion = 2; },
            (o: Offer) => Object.assign(o, { unknown: true }),
            (o: Offer) => { o.capabilities[0].id = 'UPPER'; },
            (o: Offer) => { o.controlVersions = [1.5]; },
            (o: Offer) => { o.controlVersions = [0]; },
            (o: Offer) => { o.controlVersions = [0x100000000]; },
            (o: Offer) => { o.controlVersions = []; },
            (o: Offer) => { o.capabilities.shift(); },
        ]) { const o = copy(baseline.initiatorOffer); mutate(o); expect(() => offer(o)).toThrow(); }
        const o = copy(baseline.initiatorOffer); o.admissionVersions = [2]; expect(() => select(o, baseline.responderOffer)).toThrow('BOOTSTRAP');
        expect(() => text('\ud800')).toThrow('Unicode'); expect(() => text('\udc00')).toThrow('Unicode');
        expect(() => hex('f')).toThrow('hex'); expect(() => u32(-1)).toThrow('U32');
    });
    it('retains unknown optional bytes without selecting or enabling the unknown value', () => {
        const x = fixture.vectors.find(v => v.name === 'unknown-optional-retained-disabled')!.input;
        expect(offer(x.responderOffer).equals(offer(baseline.responderOffer))).toBe(false);
        expect(select(x.initiatorOffer, x.responderOffer).capabilities.some(c => c.id === 'future/unknown')).toBe(false);
    });
});
