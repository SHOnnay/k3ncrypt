import type { CallIdentityVerifier, CallSession, CallSignal, CallSignalTransport } from './contracts';
import { verifySignalDigest } from './signalBinding';
import { MemoryReplayProtectionStore, type ReplayProtectionStore } from './replayProtection';
export class SecureCallSignaling {
  constructor(private readonly identity: CallIdentityVerifier, private readonly transport: CallSignalTransport, private readonly replay: ReplayProtectionStore = new MemoryReplayProtectionStore()) {}
  async send(session: CallSession, signal: CallSignal): Promise<void> {
    const now = Date.now();
    if (signal.callId !== session.callId || signal.conversationId !== session.conversationId || signal.identityBinding !== session.identityBinding || signal.expiresAt > session.expiresAt || signal.expiresAt <= now || signal.timestamp > now + 30_000 || signal.timestamp > signal.expiresAt || !(await verifySignalDigest(signal))) throw new Error('Invalid call signal.');
    if (!(await this.identity.isParticipant(session.conversationId, signal.sender.participantId))) throw new Error('Unauthorized call participant.');
    if (signal.sender.verification === 'changed-pending-review') throw new Error('Call identity requires review.');
    const key = `${signal.callId}:${signal.sender.participantId}:${signal.sequence}`;
    const result = await this.replay.claim(key, signal.expiresAt, now);
    if (result !== 'accepted') throw new Error(`Call signal rejected: ${result}.`);
    await this.transport.send(signal);
  }
}
