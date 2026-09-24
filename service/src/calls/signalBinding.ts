import type { CallSignal } from './contracts';
import type { CallIdentityVerifier, CallParticipant } from './contracts';
const stableJson = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
};
const canonical = (signal: Omit<CallSignal, 'payloadDigest'>): string => `{"callId":${JSON.stringify(signal.callId)},"conversationId":${JSON.stringify(signal.conversationId)},"sender":${JSON.stringify(signal.sender)},"receiverIdentityId":${JSON.stringify(signal.receiverIdentityId)},"mediaMode":${JSON.stringify(signal.mediaMode)},"nonce":${JSON.stringify(signal.nonce)},"event":${JSON.stringify(signal.event)},"kind":${JSON.stringify(signal.kind ?? 'control')},"payload":${stableJson(signal.payload ?? null)},"sequence":${signal.sequence},"timestamp":${signal.timestamp},"expiresAt":${signal.expiresAt},"identityBinding":${JSON.stringify(signal.identityBinding)}}`;
export const signalDigest = async (signal: Omit<CallSignal, 'payloadDigest'>): Promise<string> => { const bytes = new TextEncoder().encode(canonical(signal)); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''); };
export const verifySignalDigest = async (signal: CallSignal): Promise<boolean> => signal.payloadDigest === await signalDigest(signal);
export const identityBinding = async (conversationId: string, participants: readonly [CallParticipant, CallParticipant]): Promise<string> => {
    const ordered = [...participants].sort((a, b) => a.identityId.localeCompare(b.identityId)).map((participant) => `${participant.participantId}:${participant.identityId}`).join('|');
    const bytes = new TextEncoder().encode(`k3ncrypt:call-binding:v1\0${conversationId}\0${ordered}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
export class VerifiedCallIdentityVerifier implements CallIdentityVerifier {
    constructor(private readonly members: ReadonlySet<string>, private readonly verifications: ReadonlyMap<string, CallParticipant['verification']>) {}
    isParticipant(_conversationId: string, participantId: string): Promise<boolean> { return Promise.resolve(this.members.has(participantId)); }
    getVerification(participantId: string): Promise<CallParticipant['verification']> { return Promise.resolve(this.verifications.get(participantId) ?? 'unknown'); }
    identityBinding(conversationId: string, participants: readonly [CallParticipant, CallParticipant]): Promise<string> { return identityBinding(conversationId, participants); }
}
