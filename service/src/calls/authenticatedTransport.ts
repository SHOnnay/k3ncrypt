import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { CallIdentityVerifier, CallParticipant, CallProtocolIssue, CallSignal, CallSignalTransport } from './contracts';
import { CALL_SIGNAL_LIFETIME_MS } from './callSecurityPolicy';
import { diagnoseSignalDigestMismatch, signalDigestShape, verifyCurrentSignalDigest, verifyLegacySignalDigest } from './signalBinding';

const encode = (signal: CallSignal): ArrayBuffer => new TextEncoder().encode(JSON.stringify(signal)).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer): CallSignal => {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_call_signal');
  const signal = value as Record<string, unknown>;
  const version = signal.protocolVersion;
  const allowed = new Set(['protocolVersion', 'callId', 'conversationId', 'sender', 'receiverIdentityId', 'mediaMode', 'nonce', 'event', 'kind', 'payload', 'sequence', 'timestamp', 'expiresAt', 'identityBinding', 'payloadDigest']);
  if (version !== undefined && !Number.isSafeInteger(version)) throw new Error('invalid_call_signal_version');
  const unsupportedVersion = version !== undefined && version !== 2;
  if (!unsupportedVersion && Object.keys(signal).some((key) => !allowed.has(key))) throw new Error('unknown_call_signal_field');
  for (const key of ['callId', 'conversationId', 'receiverIdentityId', 'mediaMode', 'nonce', 'event', 'identityBinding', 'payloadDigest'] as const) if (typeof signal[key] !== 'string') throw new Error('invalid_call_signal_field');
  for (const key of ['sequence', 'timestamp', 'expiresAt'] as const) if (!Number.isSafeInteger(signal[key])) throw new Error('invalid_call_signal_field');
  if (!signal.sender || typeof signal.sender !== 'object' || Array.isArray(signal.sender)) throw new Error('invalid_call_signal_sender');
  const sender = signal.sender as Record<string, unknown>;
  const allowedSenderFields = new Set(['participantId', 'identityId', 'verification']);
  if (!unsupportedVersion && Object.keys(sender).some((key) => !allowedSenderFields.has(key))) throw new Error('unknown_call_signal_sender_field');
  for (const key of ['participantId', 'identityId', 'verification'] as const) if (typeof sender[key] !== 'string') throw new Error('invalid_call_signal_sender');
  return signal as unknown as CallSignal;
};
const callSignalDiagnostic = (category: 'decode-failed' | 'conversation-mismatch' | 'sender-mismatch' | 'receiver-mismatch' | 'nonce-missing' | 'sender-unverified' | 'membership-rejected' | 'digest-invalid' | 'CRLF-vs-LF' | 'escape-mismatch' | 'unicode-normalization' | 'wrapper-object-mismatch' | 'field-selection-mismatch' | 'field-order-mismatch' | 'unknown' | 'listener-missing' | 'listener-rejected'): void => {
  if (testDiagnosticsEnabled()) console.info(`k3ncrypt-call-failure:${category}`);
};
const callSignalByteDiagnostic = (signal: CallSignal): void => {
  if (!testDiagnosticsEnabled()) return;
  const shape = signalDigestShape(signal);
  const values = signal.payload && typeof signal.payload === 'object' ? Object.values(signal.payload as Record<string, unknown>).filter((item): item is string => typeof item === 'string') : [];
  const sdp = (signal.payload as { sdp?: unknown } | null)?.sdp;
  const escaping = typeof sdp === 'string' && sdp.includes('\r\n') ? 'CRLF-vs-LF'
    : typeof sdp === 'string' && /[\r\n]/.test(sdp) ? 'line-ending-variant'
    : values.some(value => /[^\x00-\x7f]/.test(value)) ? 'unicode-escape'
    : values.some(value => value.includes('/')) ? 'slash-escape-case'
    : values.some(value => /[\\"\u0000-\u001f]/.test(value)) ? 'escape-mismatch-candidate'
    : 'plain-ascii';
  console.info(`k3ncrypt-call-bytes:chrome kind=${signal.kind ?? 'control'} input-length=${shape.inputLength} hash-input-length=${shape.inputLength} payload-json-length=${shape.payloadJsonLength} sdp-value-length=${shape.sdpValueLength} metadata-length=${shape.metadataLength} escaping=${escaping}`);
};

const callSignalTransportDiagnostic = (stage: 'ice-browser-send-started'): void => {
  if (testDiagnosticsEnabled()) console.info(`k3ncrypt-call-transport:${stage}`);
};

/** Concrete signaling transport: every wire message is encrypted by the existing conversation session. */
export class AuthenticatedCallSignalTransport implements CallSignalTransport {
  private listener?: (signal: CallSignal) => Promise<void>;
  private readonly protocolIssueListeners = new Set<(issue: CallProtocolIssue) => void>();
  constructor(private readonly session: CryptoSession, private readonly transport: TransportManager, private readonly conversationId: string, private readonly localIdentityId: string, private readonly remote: CallParticipant, private readonly identity: CallIdentityVerifier, private readonly localParticipantId = localIdentityId) {}
  async send(signal: CallSignal): Promise<void> {
    if (signal.conversationId !== this.conversationId || signal.sender.identityId !== this.localIdentityId || !signal.receiverIdentityId || !signal.nonce) throw new Error('Call signal origin rejected.');
    if (signal.protocolVersion !== 2) throw new Error('Call protocol version rejected.');
    if (!(await this.identity.isParticipant(this.conversationId, signal.sender.participantId)) || signal.sender.verification !== 'verified') throw new Error('Call signal origin rejected.');
    if (!(await verifyCurrentSignalDigest(signal))) throw new Error('Call signal integrity rejected.');
    if (signal.kind === 'ice-candidate') callSignalTransportDiagnostic('ice-browser-send-started');
    await this.transport.sendEnvelope('signaling', await this.session.encrypt('signaling', encode(signal)));
  }
  onSignal(listener: (signal: CallSignal) => Promise<void>): () => void { this.listener = listener; return () => { if (this.listener === listener) this.listener = undefined; }; }
  onProtocolIssue(listener: (issue: CallProtocolIssue) => void): () => void { this.protocolIssueListeners.add(listener); return () => this.protocolIssueListeners.delete(listener); }
  async receive(envelope: EncryptedEnvelope): Promise<void> {
    await this.receivePlaintext(await this.session.decrypt('signaling', envelope));
  }
  async receivePlaintext(plaintext: ArrayBuffer): Promise<void> {
    let signal: CallSignal;
    try { signal = decode(plaintext); } catch { callSignalDiagnostic('decode-failed'); throw new Error('Call signal origin rejected.'); }
    if (signal.conversationId !== this.conversationId) { callSignalDiagnostic('conversation-mismatch'); throw new Error('Call signal origin rejected.'); }
    if (signal.sender.identityId !== this.remote.identityId) { callSignalDiagnostic('sender-mismatch'); throw new Error('Call signal origin rejected.'); }
    if (signal.receiverIdentityId !== this.localIdentityId) { callSignalDiagnostic('receiver-mismatch'); throw new Error('Call signal origin rejected.'); }
    if (!signal.nonce) { callSignalDiagnostic('nonce-missing'); throw new Error('Call signal origin rejected.'); }
    if (signal.sender.verification !== 'verified') { callSignalDiagnostic('sender-unverified'); throw new Error('Call signal origin rejected.'); }
    if (signal.sender.participantId !== this.remote.participantId) { callSignalDiagnostic('sender-mismatch'); throw new Error('Call signal origin rejected.'); }
    if (!(await this.identity.isParticipant(this.conversationId, signal.sender.participantId))) { callSignalDiagnostic('membership-rejected'); throw new Error('Call signal origin rejected.'); }
    if (await this.identity.getVerification(signal.sender.participantId) !== 'verified') throw new Error('Verification required for calls.');
    const expectedBinding = await this.identity.identityBinding(this.conversationId, [
      { participantId: this.localParticipantId, identityId: this.localIdentityId, verification: 'verified' },
      { participantId: this.remote.participantId, identityId: this.remote.identityId, verification: 'verified' },
    ]);
    if (signal.identityBinding !== expectedBinding) throw new Error('Call signal identity binding rejected.');
    const now = Date.now();
    if (!Number.isSafeInteger(signal.timestamp) || signal.timestamp < 0 || signal.timestamp > now + 30_000 || !Number.isSafeInteger(signal.expiresAt) || !Number.isSafeInteger(signal.sequence) || signal.sequence < 1) throw new Error('Call signal origin rejected.');
    if (signal.protocolVersion !== 2) {
      // Version 1 has no version field. Its old digest can be recognized for
      // an explicit incompatibility notice, but it never reaches call/replay state.
      if (signal.protocolVersion === undefined) {
        if (signal.expiresAt <= now || signal.expiresAt <= signal.timestamp || !await verifyLegacySignalDigest(signal)) throw new Error('Call signal integrity rejected.');
      } else if (signal.timestamp < now - CALL_SIGNAL_LIFETIME_MS) throw new Error('Call signal is stale.');
      if (signal.protocolVersion !== undefined && await verifyCurrentSignalDigest({ ...signal, protocolVersion: 2 })) throw new Error('Call signal protocol version was altered.');
      const issue: CallProtocolIssue = { callId: signal.callId, receivedVersion: signal.protocolVersion ?? 1, requiredVersion: 2 };
      this.protocolIssueListeners.forEach((notify) => notify(issue));
      return;
    }
    const digestValid = await verifyCurrentSignalDigest(signal);
    if (signal.kind === 'offer' || !digestValid) callSignalByteDiagnostic(signal);
    if (!digestValid) { callSignalDiagnostic(await diagnoseSignalDigestMismatch(signal)); throw new Error('Call signal origin rejected.'); }
    if (!this.listener) { callSignalDiagnostic('listener-missing'); throw new Error('Call signal handler unavailable.'); }
    try { await this.listener(signal); } catch { callSignalDiagnostic('listener-rejected'); throw new Error('Call signal handler rejected.'); }
  }
}
