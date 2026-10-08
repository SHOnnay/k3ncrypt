import type { CallIdentityVerifier, CallSession, CallSignal, CallSignalTransport } from './contracts';
import { verifySignalDigest } from './signalBinding';
import { MemoryReplayProtectionStore, type ReplayProtectionStore } from './replayProtection';
import { CALL_SIGNAL_LIFETIME_MS } from './callSecurityPolicy';

const validSignalSemantics = (signal: CallSignal): boolean => {
  const kind = signal.kind ?? 'control';
  const payload = signal.payload;
  const record = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined;
  if (['invite', 'accept', 'reject', 'cancel', 'end', 'expire', 'fail'].includes(signal.event)) return kind === 'control' && payload === undefined;
  if (signal.event === 'connect' || signal.event === 'reconnect') return kind === 'offer' && record?.type === 'offer' && typeof record.sdp === 'string' && record.sdp.length > 0;
  if (signal.event === 'connected') return kind === 'answer'
    ? record?.type === 'answer' && typeof record.sdp === 'string' && record.sdp.length > 0
    : kind === 'ice-candidate' && typeof record?.candidate === 'string' && record.candidate.length > 0;
  return false;
};

const replayKey = (signal: CallSignal): string =>
  JSON.stringify([signal.conversationId, signal.callId, signal.sender.participantId, signal.sequence]);

export class SecureCallSignaling {
  constructor(private readonly identity: CallIdentityVerifier, private readonly transport: CallSignalTransport, private readonly replay: ReplayProtectionStore = new MemoryReplayProtectionStore()) {}
  async send(session: CallSession, signal: CallSignal): Promise<void> {
    const now = Date.now();
    if (session.protocolVersion !== 2 || signal.protocolVersion !== session.protocolVersion || !validSignalSemantics(signal) || signal.callId !== session.callId || signal.conversationId !== session.conversationId || signal.identityBinding !== session.identityBinding || signal.mediaMode !== session.mediaMode || !signal.nonce || !signal.receiverIdentityId || !Number.isSafeInteger(signal.timestamp) || !Number.isSafeInteger(signal.expiresAt) || signal.timestamp < 0 || signal.expiresAt <= now || signal.expiresAt <= signal.timestamp || signal.expiresAt - signal.timestamp > CALL_SIGNAL_LIFETIME_MS || signal.timestamp > now + 30_000 || !(await verifySignalDigest(signal))) throw new Error('Invalid call signal.');
    if (!(await this.identity.isParticipant(session.conversationId, signal.sender.participantId))) throw new Error('Unauthorized call participant.');
    if (await this.identity.getVerification(signal.sender.participantId) !== 'verified') throw new Error('Verification required for calls.');
    if (signal.sender.verification === 'changed-pending-review') throw new Error('Call identity requires review.');
    const key = replayKey(signal);
    const result = await this.replay.claim(key, signal.expiresAt, now);
    if (result !== 'accepted') throw new Error(`Call signal rejected: ${result}.`);
    await this.transport.send(signal);
  }

  /** Validates and replay-checks a signal after authenticated decryption. */
  async receive(signal: CallSignal, listener: (signal: CallSignal) => Promise<void>): Promise<void> {
    const now = Date.now();
    if (signal.protocolVersion !== 2 || !validSignalSemantics(signal) || !signal.callId || !signal.conversationId || !signal.nonce || !signal.receiverIdentityId || !['audio', 'video'].includes(signal.mediaMode) || !Number.isSafeInteger(signal.timestamp) || !Number.isSafeInteger(signal.expiresAt) || signal.timestamp < 0 || signal.expiresAt <= now || signal.expiresAt <= signal.timestamp || signal.expiresAt - signal.timestamp > CALL_SIGNAL_LIFETIME_MS || signal.timestamp > now + 30_000 || !(await verifySignalDigest(signal))) throw new Error('Invalid call signal.');
    // Remote 'verified' is a legacy schema value, never local verification evidence.
    if (!(await this.identity.isParticipant(signal.conversationId, signal.sender.participantId)) || await this.identity.getVerification(signal.sender.participantId) !== 'verified' || signal.sender.verification !== 'verified') {
      throw new Error('Unauthorized call participant.');
    }
    const key = replayKey(signal);
    const result = await this.replay.claim(key, signal.expiresAt, now);
    if (result !== 'accepted') throw new Error(`Call signal rejected: ${result}.`);
    await listener(signal);
  }

  onSignal(listener: (signal: CallSignal) => Promise<void>): () => void {
    return this.transport.onSignal((signal) => this.receive(signal, listener));
  }
}
