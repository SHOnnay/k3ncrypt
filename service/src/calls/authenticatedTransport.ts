import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { CallIdentityVerifier, CallParticipant, CallSignal, CallSignalTransport } from './contracts';
import { diagnoseSignalDigestMismatch, signalDigestShape, verifySignalDigest } from './signalBinding';

const encode = (signal: CallSignal): ArrayBuffer => new TextEncoder().encode(JSON.stringify(signal)).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer): CallSignal => JSON.parse(new TextDecoder().decode(bytes)) as CallSignal;
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
  constructor(private readonly session: CryptoSession, private readonly transport: TransportManager, private readonly conversationId: string, private readonly localIdentityId: string, private readonly remote: CallParticipant, private readonly identity: CallIdentityVerifier) {}
  async send(signal: CallSignal): Promise<void> {
    if (signal.conversationId !== this.conversationId || signal.sender.identityId !== this.localIdentityId || !signal.receiverIdentityId || !signal.nonce) throw new Error('Call signal origin rejected.');
    if (!(await this.identity.isParticipant(this.conversationId, signal.sender.participantId)) || signal.sender.verification !== 'verified') throw new Error('Call signal origin rejected.');
    if (!(await verifySignalDigest(signal))) throw new Error('Call signal integrity rejected.');
    if (signal.kind === 'ice-candidate') callSignalTransportDiagnostic('ice-browser-send-started');
    await this.transport.sendEnvelope('signaling', await this.session.encrypt('signaling', encode(signal)));
  }
  onSignal(listener: (signal: CallSignal) => Promise<void>): () => void { this.listener = listener; return () => { if (this.listener === listener) this.listener = undefined; }; }
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
    if (!(await this.identity.isParticipant(this.conversationId, signal.sender.participantId))) { callSignalDiagnostic('membership-rejected'); throw new Error('Call signal origin rejected.'); }
    const digestValid = await verifySignalDigest(signal);
    if (signal.kind === 'offer' || !digestValid) callSignalByteDiagnostic(signal);
    if (!digestValid) { callSignalDiagnostic(await diagnoseSignalDigestMismatch(signal)); throw new Error('Call signal origin rejected.'); }
    if (!this.listener) { callSignalDiagnostic('listener-missing'); throw new Error('Call signal handler unavailable.'); }
    try { await this.listener(signal); } catch { callSignalDiagnostic('listener-rejected'); throw new Error('Call signal handler rejected.'); }
  }
}
