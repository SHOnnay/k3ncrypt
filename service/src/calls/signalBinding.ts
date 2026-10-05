import type { CallSignal } from './contracts';
import type { CallIdentityVerifier, CallParticipant } from './contracts';
type StringQuoter = (value: string) => string;
const javascriptQuote: StringQuoter = (value) => JSON.stringify(value);
/** Mirrors the Android org.json slash escape for diagnostics of legacy call digests. */
const androidJsonQuote: StringQuoter = (value) => JSON.stringify(value).replace(/\//g, '\\/');
const stableJson = (value: unknown, separator = ',', sortKeys = true, quote: StringQuoter = javascriptQuote): string => {
    if (typeof value === 'string') return quote(value);
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, separator, sortKeys, quote)).join(separator)}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (sortKeys) keys.sort();
    return `{${keys.map((key) => `${quote(key)}:${stableJson(record[key], separator, sortKeys, quote)}`).join(separator)}}`;
};
const canonical = (signal: Omit<CallSignal, 'payloadDigest'>, separator = ',', sortKeys = true, quote: StringQuoter = javascriptQuote): string => {
    const sender = quote === javascriptQuote ? JSON.stringify(signal.sender) : stableJson(signal.sender, ',', false, quote);
    return `{"callId":${quote(signal.callId)},"conversationId":${quote(signal.conversationId)},"sender":${sender},"receiverIdentityId":${quote(signal.receiverIdentityId)},"mediaMode":${quote(signal.mediaMode)},"nonce":${quote(signal.nonce)},"event":${quote(signal.event)},"kind":${quote(signal.kind ?? 'control')},"payload":${stableJson(signal.payload ?? null, separator, sortKeys, quote)},"sequence":${signal.sequence},"timestamp":${signal.timestamp},"expiresAt":${signal.expiresAt},"identityBinding":${quote(signal.identityBinding)}}`;
};
const digestCanonical = async (value: string): Promise<string> => { const bytes = new TextEncoder().encode(value); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''); };
export const signalDigest = async (signal: Omit<CallSignal, 'payloadDigest'>): Promise<string> => digestCanonical(canonical(signal));
/** Debug-only callers may observe the byte count without accessing canonical bytes. */
export const signalDigestInputByteLength = (signal: CallSignal): number => new TextEncoder().encode(canonical(signal)).byteLength;
export const signalDigestShape = (signal: CallSignal): { inputLength: number; payloadJsonLength: number; sdpValueLength: number; metadataLength: number } => {
    const encoder = new TextEncoder();
    const payloadJson = stableJson(signal.payload ?? null);
    const inputLength = encoder.encode(canonical(signal)).byteLength;
    const payloadJsonLength = encoder.encode(payloadJson).byteLength;
    const sdp = signal.payload && typeof signal.payload === 'object' ? (signal.payload as Record<string, unknown>).sdp : undefined;
    return { inputLength, payloadJsonLength, sdpValueLength: typeof sdp === 'string' ? encoder.encode(sdp).byteLength : 0, metadataLength: inputLength - payloadJsonLength };
};
export const androidJsonQuoteSignalDigestForTest = async (signal: Omit<CallSignal, 'payloadDigest'>): Promise<string> => digestCanonical(canonical(signal, ',', true, androidJsonQuote));
export const matchesLegacySpacedSignalDigest = async (signal: CallSignal): Promise<boolean> => signal.payloadDigest === await digestCanonical(canonical(signal, ', '));
const normalizePayloadStrings = (value: unknown, form: 'NFC' | 'NFD'): unknown => {
    if (typeof value === 'string') return value.normalize(form);
    if (Array.isArray(value)) return value.map(item => normalizePayloadStrings(item, form));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePayloadStrings(item, form)]));
    return value;
};
export const diagnoseSignalDigestMismatch = async (signal: CallSignal): Promise<'CRLF-vs-LF' | 'escape-mismatch' | 'unicode-normalization' | 'wrapper-object-mismatch' | 'field-selection-mismatch' | 'field-order-mismatch' | 'unknown'> => {
    if (signal.payload && signal.payloadDigest === await digestCanonical(canonical(signal, ',', false))) return 'field-order-mismatch';
    const payload = signal.payload;
    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).sdp === 'string') {
        const sdp = (payload as Record<string, string>).sdp;
        for (const normalized of [sdp.replace(/\r\n/g, '\n'), sdp.replace(/\r?\n/g, '\r\n'), sdp.replace(/(?:\r\n|\n)+$/g, '')]) {
            const candidate = { ...signal, payload: { ...payload, sdp: normalized } };
            if (signal.payloadDigest === await digestCanonical(canonical(candidate))) return 'CRLF-vs-LF';
        }
    }
    if (signal.payloadDigest === await digestCanonical(canonical(signal, ',', true, androidJsonQuote))) return 'escape-mismatch';
    if (payload) {
        for (const form of ['NFC', 'NFD'] as const) {
            if (signal.payloadDigest === await digestCanonical(canonical({ ...signal, payload: normalizePayloadStrings(payload, form) } as CallSignal))) return 'unicode-normalization';
        }
    }
    if (payload && signal.payloadDigest === await digestCanonical(canonical({ ...signal, payload: stableJson(payload) } as CallSignal))) return 'wrapper-object-mismatch';
    if (signal.payloadDigest === await digestCanonical(canonical({ ...signal, kind: undefined, payload: undefined } as CallSignal))) return 'field-selection-mismatch';
    return 'unknown';
};
export const verifySignalDigest = async (signal: CallSignal): Promise<boolean> => signal.payloadDigest === await signalDigest(signal);
export const identityBinding = async (conversationId: string, participants: readonly [CallParticipant, CallParticipant]): Promise<string> => {
    const ordered = [...participants].sort((a, b) => a.identityId.localeCompare(b.identityId)).map((participant) => `${participant.participantId}:${participant.identityId}`).join('|');
    const bytes = new TextEncoder().encode(`k3ncrypt:call-binding:v1\0${conversationId}\0${ordered}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
export class VerifiedCallIdentityVerifier implements CallIdentityVerifier {
    constructor(private readonly members: ReadonlySet<string>, private readonly verifications: ReadonlyMap<string, CallParticipant['verification']>, private readonly currentVerification?: () => Promise<CallParticipant['verification']>) {}
    isParticipant(_conversationId: string, participantId: string): Promise<boolean> { return Promise.resolve(this.members.has(participantId)); }
    async getVerification(participantId: string): Promise<CallParticipant['verification']> { if (!this.members.has(participantId)) return 'unknown'; return this.currentVerification ? this.currentVerification().catch(() => 'unknown' as const) : this.verifications.get(participantId) ?? 'unknown'; }
    identityBinding(conversationId: string, participants: readonly [CallParticipant, CallParticipant]): Promise<string> { return identityBinding(conversationId, participants); }
}
