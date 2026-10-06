import type { CallIdentityVerifier, CallSession, CallSignal, CallSignalTransport } from './contracts';
import { verifySignalDigest } from './signalBinding';
import { MemoryReplayProtectionStore, type ReplayProtectionStore } from './replayProtection';
import { CALL_SIGNAL_LIFETIME_MS } from './callSecurityPolicy';
export class SecureCallSignaling {
  constructor(private readonly identity: CallIdentityVerifier, private readonly transport: CallSignalTransport, private readonly replay: ReplayProtectionStore = new MemoryReplayProtectionStore()) {}
  async send(session: CallSession, signal: CallSignal): Promise<void> {
    const now = Date.now();
    if (signal.callId !== session.callId || signal.conversationId !== session.conversationId || signal.identityBinding !== session.identityBinding || signal.mediaMode !== session.mediaMode || !signal.nonce || !signal.receiverIdentityId || !Number.isSafeInteger(signal.timestamp) || !Number.isSafeInteger(signal.expiresAt) || signal.timestamp < 0 || signal.expiresAt <= now || signal.expiresAt <= signal.timestamp || signal.expiresAt - signal.timestamp > CALL_SIGNAL_LIFETIME_MS || signal.timestamp > now + 30_000 || !(await verifySignalDigest(signal))) throw new Error('Invalid call signal.');
    if (!(await this.identity.isParticipant(session.conversationId, signal.sender.participantId))) throw new Error('Unauthorized call participant.');
    if (await this.identity.getVerification(signal.sender.participantId) !== 'verified') throw new Error('Verification required for calls.');
    if (signal.sender.verification === 'changed-pending-review') throw new Error('Call identity requires review.');
    const key = `${signal.callId}:${signal.sender.participantId}:${signal.sequence}`;
    const result = await this.replay.claim(key, signal.expiresAt, now);
    if (result !== 'accepted') throw new Error(`Call signal rejected: ${result}.`);
    await this.transport.send(signal);
  }

  /** Validates and replay-checks a signal after authenticated decryption. */
  async receive(signal: CallSignal, listener: (signal: CallSignal) => Promise<void>): Promise<void> {
    const now = Date.now();
    if (!signal.callId || !signal.conversationId || !signal.nonce || !signal.receiverIdentityId || !['audio', 'video'].includes(signal.mediaMode) || !Number.isSafeInteger(signal.timestamp) || !Number.isSafeInteger(signal.expiresAt) || signal.timestamp < 0 || signal.expiresAt <= now || signal.expiresAt <= signal.timestamp || signal.expiresAt - signal.timestamp > CALL_SIGNAL_LIFETIME_MS || signal.timestamp > now + 30_000 || !(await verifySignalDigest(signal))) throw new Error('Invalid call signal.');
    // Remote 'verified' is a legacy schema value, never local verification evidence.
    if (!(await this.identity.isParticipant(signal.conversationId, signal.sender.participantId)) || await this.identity.getVerification(signal.sender.participantId) !== 'verified' || signal.sender.verification !== 'verified') {
      throw new Error('Unauthorized call participant.');
    }
    const key = `${signal.callId}:${signal.sender.participantId}:${signal.sequence}`;
    const result = await this.replay.claim(key, signal.expiresAt, now);
    if (result !== 'accepted') throw new Error(`Call signal rejected: ${result}.`);
    await listener(signal);
  }

  onSignal(listener: (signal: CallSignal) => Promise<void>): () => void {
    return this.transport.onSignal((signal) => this.receive(signal, listener));
  }
}
