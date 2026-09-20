import type { CallSignal } from './contracts';
import type { CallIdentityVerifier, CallParticipant } from './contracts';
const canonical = (signal: Omit<CallSignal, 'payloadDigest'>): string => JSON.stringify({ callId: signal.callId, conversationId: signal.conversationId, sender: signal.sender, event: signal.event, kind: signal.kind ?? 'control', payload: signal.payload ?? null, sequence: signal.sequence, timestamp: signal.timestamp, expiresAt: signal.expiresAt, identityBinding: signal.identityBinding });
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
