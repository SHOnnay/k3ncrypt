import type { AuthenticatedCallComposition } from './composition';
import type { CallSession, CallSignal } from './contracts';
import { CallMediaController, type CaptureKind } from './media';
import type { CallMediaConnection, CallTransport, WebRtcConfigProvider } from './webrtc';

type Description = { type: 'offer' | 'answer'; sdp: string };
type Candidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string };
const description = (value: unknown, type: Description['type']): value is Description => !!value && typeof value === 'object' && (value as Description).type === type && typeof (value as Description).sdp === 'string' && (value as Description).sdp.length > 0 && (value as Description).sdp.length <= 65_536;
const candidate = (value: unknown): value is Candidate => !!value && typeof value === 'object' && typeof (value as Candidate).candidate === 'string' && (value as Candidate).candidate.length > 0 && (value as Candidate).candidate.length <= 8_192;

/** Browser media adapter: authenticated signaling enters here only after call composition validation. */
export class ProductionCallNegotiator {
  private readonly connections = new Map<string, CallMediaConnection>();
  private readonly queued = new Map<string, Candidate[]>();
  private readonly unsubscribe: () => void;
  constructor(private readonly calls: AuthenticatedCallComposition, private readonly transport: CallTransport, private readonly config: WebRtcConfigProvider, private readonly media = new CallMediaController()) {
    this.unsubscribe = calls.onMediaSignal((session, signal) => this.receive(session, signal));
  }
  async prepareOutgoing(session: CallSession, kind: CaptureKind = 'microphone'): Promise<void> { await this.prepare(session, kind); }
  async acceptIncoming(session: CallSession, kind: CaptureKind = 'microphone'): Promise<void> { await this.prepare(session, kind); }
  async beginOffer(callId: string, restart = false): Promise<void> {
    const session = await this.require(callId); const connection = this.connections.get(callId);
    if (!connection) throw new Error('Call media is not prepared.');
    if (session.state === 'accepted') await this.calls.service.event(callId, 'connect');
    else if (restart && session.state === 'connected') await this.calls.service.event(callId, 'reconnect');
    const offer = await connection.createOffer(restart);
    if (!description(offer, 'offer')) throw new Error('WebRTC offer rejected.');
    await this.calls.sendMediaSignal(callId, restart ? 'reconnect' : 'connect', 'offer', offer);
  }
  async end(callId: string): Promise<void> { const session = await this.calls.service.get(callId); if (session && ['connected', 'reconnecting'].includes(session.state)) await this.calls.service.event(callId, 'end'); await this.cleanup(callId); }
  dispose(): void { this.unsubscribe(); for (const id of this.connections.keys()) void this.cleanup(id); }
  private async receive(session: CallSession, signal: CallSignal): Promise<void> {
    const connection = this.connections.get(session.callId);
    if (signal.kind === 'offer') {
      if (!description(signal.payload, 'offer') || !connection) throw new Error('WebRTC offer rejected.');
      if (session.state === 'accepted') await this.calls.service.event(session.callId, 'connect');
      const answer = await connection.acceptOffer(signal.payload);
      if (!description(answer, 'answer')) throw new Error('WebRTC answer rejected.');
      await this.flush(session.callId, connection);
      await this.calls.sendMediaSignal(session.callId, 'connected', 'answer', answer);
      return;
    }
    if (signal.kind === 'answer') {
      if (!description(signal.payload, 'answer') || !connection) throw new Error('WebRTC answer rejected.');
      await connection.acceptAnswer(signal.payload); await this.flush(session.callId, connection);
      const current = await this.require(session.callId); if (current.state === 'connecting') await this.calls.service.event(session.callId, 'connected');
      return;
    }
    if (!candidate(signal.payload)) throw new Error('WebRTC candidate rejected.');
    if (!connection) { const list = this.queued.get(session.callId) ?? []; list.push(signal.payload); this.queued.set(session.callId, list); return; }
    await connection.addIceCandidate(signal.payload);
  }
  private async prepare(session: CallSession, kind: CaptureKind): Promise<void> {
    if (this.connections.has(session.callId)) return;
    const connection = await this.transport.connect(session, await this.config(session));
    try {
      const stream = await this.media.request(kind);
      (connection as CallMediaConnection & { addStream?: (value: MediaStream) => void }).addStream?.(stream);
      connection.onIceCandidate((value) => { if (candidate(value)) void this.calls.sendMediaSignal(session.callId, 'connected', 'ice-candidate', value).catch(() => undefined); });
      connection.onStateChange((state) => { if (state === 'reconnecting') void this.beginOffer(session.callId, true).catch(() => this.fail(session.callId)); if (state === 'failed') void this.fail(session.callId); if (state === 'connected') void this.connected(session.callId); });
      this.connections.set(session.callId, connection); await this.flush(session.callId, connection);
    } catch (error) { await connection.close().catch(() => undefined); this.media.release(); throw error; }
  }
  private async connected(callId: string): Promise<void> { const session = await this.require(callId); if (session.state === 'connecting') await this.calls.service.event(callId, 'connected'); }
  private async fail(callId: string): Promise<void> { const session = await this.calls.service.get(callId); if (session && !['ended', 'failed', 'cancelled', 'rejected', 'expired'].includes(session.state)) await this.calls.service.event(callId, 'fail'); await this.cleanup(callId); }
  private async cleanup(callId: string): Promise<void> { const connection = this.connections.get(callId); this.connections.delete(callId); this.queued.delete(callId); await connection?.close(); this.media.release(); }
  private async flush(callId: string, connection: CallMediaConnection): Promise<void> { const list = this.queued.get(callId) ?? []; this.queued.delete(callId); for (const item of list) await connection.addIceCandidate(item); }
  private async require(callId: string): Promise<CallSession> { const session = await this.calls.service.get(callId); if (!session || session.expiresAt <= Date.now()) throw new Error('Call has expired.'); return session; }
}
