import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { CallIdentityVerifier, CallParticipant, CallSignal, CallSignalTransport } from './contracts';
import { verifySignalDigest } from './signalBinding';

const encode = (signal: CallSignal): ArrayBuffer => new TextEncoder().encode(JSON.stringify(signal)).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer): CallSignal => JSON.parse(new TextDecoder().decode(bytes)) as CallSignal;

/** Concrete signaling transport: every wire message is encrypted by the existing conversation session. */
export class AuthenticatedCallSignalTransport implements CallSignalTransport {
  private listener?: (signal: CallSignal) => Promise<void>;
  constructor(private readonly session: CryptoSession, private readonly transport: TransportManager, private readonly conversationId: string, private readonly localIdentityId: string, private readonly remote: CallParticipant, private readonly identity: CallIdentityVerifier) {}
  async send(signal: CallSignal): Promise<void> {
    if (signal.conversationId !== this.conversationId || signal.sender.identityId !== this.localIdentityId || !signal.receiverIdentityId || !signal.nonce) throw new Error('Call signal origin rejected.');
    if (!(await this.identity.isParticipant(this.conversationId, signal.sender.participantId)) || signal.sender.verification !== 'verified') throw new Error('Call signal origin rejected.');
    if (!(await verifySignalDigest(signal))) throw new Error('Call signal integrity rejected.');
    await this.transport.sendEnvelope('signaling', await this.session.encrypt('signaling', encode(signal)));
  }
  onSignal(listener: (signal: CallSignal) => Promise<void>): () => void { this.listener = listener; return () => { if (this.listener === listener) this.listener = undefined; }; }
  async receive(envelope: EncryptedEnvelope): Promise<void> {
    await this.receivePlaintext(await this.session.decrypt('signaling', envelope));
  }
  async receivePlaintext(plaintext: ArrayBuffer): Promise<void> {
    const signal = decode(plaintext);
    if (signal.conversationId !== this.conversationId || signal.sender.identityId !== this.remote.identityId || signal.receiverIdentityId !== this.localIdentityId || !signal.nonce || signal.sender.verification !== 'verified' || !(await this.identity.isParticipant(this.conversationId, signal.sender.participantId)) || !(await verifySignalDigest(signal))) throw new Error('Call signal origin rejected.');
    if (this.listener) await this.listener(signal);
  }
}
