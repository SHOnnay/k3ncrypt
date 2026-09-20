import type { CallIdentityVerifier, CallSession, CallSignal, CallSignalTransport } from './contracts';
export class SecureCallSignaling {
  private readonly seen = new Set<string>();
  constructor(private readonly identity: CallIdentityVerifier, private readonly transport: CallSignalTransport) {}
  async send(session: CallSession, signal: CallSignal): Promise<void> {
    if (signal.callId !== session.callId || signal.conversationId !== session.conversationId || signal.identityBinding !== session.identityBinding || signal.expiresAt > session.expiresAt || signal.expiresAt <= Date.now()) throw new Error('Invalid call signal.');
    if (!(await this.identity.isParticipant(session.conversationId, signal.sender.participantId))) throw new Error('Unauthorized call participant.');
    if (signal.sender.verification === 'changed-pending-review') throw new Error('Call identity requires review.');
    const key = `${signal.callId}:${signal.sender.participantId}:${signal.sequence}`;
    if (this.seen.has(key)) return;
    this.seen.add(key); await this.transport.send(signal);
  }
}
