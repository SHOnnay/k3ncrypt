import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { AuthenticatedCallComposition } from './composition';
import type { CallSession, CallSignal } from './contracts';
import { CallMediaController, type CaptureKind } from './media';
import type { CallMediaConnection, CallTransport, WebRtcConfigProvider } from './webrtc';
import { traceIceTiming } from './iceTiming';

type Description = { type: 'offer' | 'answer'; sdp: string };
type Candidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string };
const description = (value: unknown, type: Description['type']): value is Description => !!value && typeof value === 'object' && (value as Description).type === type && typeof (value as Description).sdp === 'string' && (value as Description).sdp.length > 0 && (value as Description).sdp.length <= 65_536;
const candidate = (value: unknown): value is Candidate => !!value && typeof value === 'object' && typeof (value as Candidate).candidate === 'string' && (value as Candidate).candidate.length > 0 && (value as Candidate).candidate.length <= 8_192;
const iceCandidateType = (value: string): 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown' => {
  const type = value.match(/\btyp\s+(host|srflx|relay|prflx)\b/)?.[1];
  return type === 'host' || type === 'srflx' || type === 'relay' || type === 'prflx' ? type : 'unknown';
};
const iceStageDiagnostic = (stage: string): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined') return;
  const root = document.documentElement;
  const prior = root.dataset.k3ncryptIceTrace?.split(',').filter(Boolean) ?? [];
  if (prior.length < 160) prior.push(stage);
  root.dataset.k3ncryptIceTrace = prior.join(',');
  console.info(`k3ncrypt-call-ice:${stage}`);
};
const callNegotiationDiagnostic = (category: 'offer-payload-invalid' | 'peer-missing-for-offer' | 'offer-applied' | 'answer-sent' | 'answer-payload-invalid' | 'peer-missing-for-answer' | 'answer-applied' | 'candidate-payload-invalid' | 'candidate-peer-missing' | 'candidate-add-failed'): void => {
  if (testDiagnosticsEnabled()) console.info(`k3ncrypt-call-negotiation:${category}`);
};
const callStabilityDiagnostic = (stage: 'failure-handler-entered' | 'cleanup-trigger', reason: 'peer-failed' | 'local-end' | 'negotiator-dispose'): void => {
  if (!testDiagnosticsEnabled()) return;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const prior = root.dataset.k3ncryptCallStabilityTrace?.split(',').filter(Boolean) ?? [];
    if (prior.length < 80) prior.push(`${stage}:${reason}`);
    root.dataset.k3ncryptCallStabilityTrace = prior.join(',');
  }
  console.info(`k3ncrypt-call-stability:${stage}`, { reason });
};

/** Browser media adapter: authenticated signaling enters here only after call composition validation. */
export class ProductionCallNegotiator {
  private readonly connections = new Map<string, CallMediaConnection>();
  private readonly queued = new Map<string, Candidate[]>();
  private readonly remoteDescriptionReady = new Set<string>();
  private readonly unsubscribe: () => void;
  private readonly localStreams = new Map<string, MediaStream>();
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly firstRemoteCandidateTimed = new Set<string>();
  private readonly ending = new Map<string, Promise<void>>();
  private readonly mediaListeners = new Set<(value: { callId: string; local?: MediaStream; remote?: MediaStream; state?: import('./webrtc').CallMediaState }) => void>();
  constructor(private readonly calls: AuthenticatedCallComposition, private readonly transport: CallTransport, private readonly config: WebRtcConfigProvider, private readonly media = new CallMediaController()) {
    this.unsubscribe = calls.onMediaSignal((session, signal) => this.receive(session, signal));
  }
  async requestMedia(kind: CaptureKind): Promise<MediaStream> {
    await this.calls.assertVerifiedContact?.();
    const stream = await this.media.request(kind);
    try { await this.calls.assertVerifiedContact?.(); return stream; }
    catch (error) { this.media.release(); throw error; }
  }
  async prepareOutgoing(session: CallSession, kind: CaptureKind = session.mediaMode === 'video' ? 'camera' : 'microphone'): Promise<void> { await this.prepare(session, kind); }
  async acceptIncoming(session: CallSession, kind: CaptureKind = session.mediaMode === 'video' ? 'camera' : 'microphone'): Promise<void> { await this.prepare(session, kind); }
  getStreams(callId: string): { local?: MediaStream; remote?: MediaStream } { return { local: this.localStreams.get(callId), remote: this.remoteStreams.get(callId) }; }
  onMediaUpdate(listener: (value: { callId: string; local?: MediaStream; remote?: MediaStream; state?: import('./webrtc').CallMediaState }) => void): () => void { this.mediaListeners.add(listener); return () => this.mediaListeners.delete(listener); }
  setMicrophoneEnabled(enabled: boolean): void { this.media.setMicrophoneEnabled(enabled); }
  setCameraEnabled(enabled: boolean): void { this.media.setCameraEnabled(enabled); }
  async switchCamera(): Promise<boolean> { return this.media.switchCamera(); }
  async beginOffer(callId: string, restart = false): Promise<void> {
    const session = await this.require(callId); const connection = this.connections.get(callId);
    if (!connection) throw new Error('Call media is not prepared.');
    if (session.state === 'accepted') await this.calls.service.event(callId, 'connect');
    else if (restart && session.state === 'connected') await this.calls.service.event(callId, 'reconnect');
    const offer = await connection.createOffer(restart);
    if (!description(offer, 'offer')) throw new Error('WebRTC offer rejected.');
    await this.calls.sendMediaSignal(callId, restart ? 'reconnect' : 'connect', 'offer', offer);
  }
  async end(callId: string): Promise<void> {
    const ongoing = this.ending.get(callId);
    if (ongoing) return ongoing;
    // Register before invoking composition.end(): its local state notification
    // can synchronously re-enter this method through ChatContext.
    const ending = Promise.resolve().then(async () => {
      try {
        await this.calls.end(callId);
      } finally {
        callStabilityDiagnostic('cleanup-trigger', 'local-end');
        await this.cleanup(callId);
      }
    });
    this.ending.set(callId, ending);
    void ending.finally(() => { if (this.ending.get(callId) === ending) this.ending.delete(callId); }).catch(() => undefined);
    return ending;
  }
  dispose(): void { this.unsubscribe(); this.media.release(); for (const id of this.connections.keys()) { callStabilityDiagnostic('cleanup-trigger', 'negotiator-dispose'); void this.cleanup(id); } }
  private async receive(session: CallSession, signal: CallSignal): Promise<void> {
    const connection = this.connections.get(session.callId);
    if (signal.kind === 'offer') {
      if (!description(signal.payload, 'offer')) { callNegotiationDiagnostic('offer-payload-invalid'); throw new Error('WebRTC offer rejected.'); }
      if (!connection) { callNegotiationDiagnostic('peer-missing-for-offer'); throw new Error('WebRTC offer rejected.'); }
      if (session.state === 'accepted') await this.calls.service.event(session.callId, 'connect');
      this.remoteDescriptionReady.delete(session.callId);
      const answer = await connection.acceptOffer(signal.payload);
      this.remoteDescriptionReady.add(session.callId);
      callNegotiationDiagnostic('offer-applied');
      if (!description(answer, 'answer')) throw new Error('WebRTC answer rejected.');
      await this.flush(session.callId, connection);
      await this.calls.sendMediaSignal(session.callId, 'connected', 'answer', answer);
      callNegotiationDiagnostic('answer-sent');
      return;
    }
    if (signal.kind === 'answer') {
      if (!description(signal.payload, 'answer')) { callNegotiationDiagnostic('answer-payload-invalid'); throw new Error('WebRTC answer rejected.'); }
      if (!connection) { callNegotiationDiagnostic('peer-missing-for-answer'); throw new Error('WebRTC answer rejected.'); }
      this.remoteDescriptionReady.delete(session.callId);
      await connection.acceptAnswer(signal.payload);
      this.remoteDescriptionReady.add(session.callId);
      callNegotiationDiagnostic('answer-applied'); await this.flush(session.callId, connection);
      const current = await this.require(session.callId); if (current.state === 'connecting') await this.calls.service.event(session.callId, 'connected');
      return;
    }
    if (!candidate(signal.payload)) { callNegotiationDiagnostic('candidate-payload-invalid'); throw new Error('WebRTC candidate rejected.'); }
    if (!this.firstRemoteCandidateTimed.has(session.callId)) {
      this.firstRemoteCandidateTimed.add(session.callId);
      traceIceTiming('first-remote-candidate-received');
    }
    iceStageDiagnostic(`ice-remote-candidate-${iceCandidateType(signal.payload.candidate)}-received`);
    if (!connection || !this.remoteDescriptionReady.has(session.callId)) {
      if (!connection) callNegotiationDiagnostic('candidate-peer-missing');
      const list = this.queued.get(session.callId) ?? [];
      list.push(signal.payload);
      this.queued.set(session.callId, list);
      return;
    }
    try { await connection.addIceCandidate(signal.payload); } catch { callNegotiationDiagnostic('candidate-add-failed'); throw new Error('WebRTC candidate rejected.'); }
  }
  private async prepare(session: CallSession, kind: CaptureKind): Promise<void> {
    await this.calls.assertVerifiedContact?.();
    if (this.connections.has(session.callId)) return;
    const connection = await this.transport.connect(session, await this.config(session));
    try {
      const stream = await this.requestMedia(kind);
      (connection as CallMediaConnection & { addStream?: (value: MediaStream) => void }).addStream?.(stream);
      connection.onIceCandidate((value) => {
        if (!candidate(value)) return;
        void this.calls.sendMediaSignal(session.callId, 'connected', 'ice-candidate', value)
          .then(() => iceStageDiagnostic(`ice-local-candidate-${iceCandidateType(value.candidate)}-relay-acknowledged`))
          .catch(() => iceStageDiagnostic(`ice-local-candidate-${iceCandidateType(value.candidate)}-relay-failed`));
      });
      const local = this.media.activeStream;
      if (local) this.localStreams.set(session.callId, local);
      connection.onRemoteStream?.((remote) => { this.remoteStreams.set(session.callId, remote); this.mediaListeners.forEach((listener) => listener({ callId: session.callId, local, remote })); });
      connection.onStateChange((state) => { this.mediaListeners.forEach((listener) => listener({ callId: session.callId, local, remote: this.remoteStreams.get(session.callId), state })); if (state === 'reconnecting') void this.beginOffer(session.callId, true).catch(() => this.fail(session.callId)); if (state === 'failed') void this.fail(session.callId); if (state === 'connected') void this.connected(session.callId); });
      this.connections.set(session.callId, connection);
    } catch (error) { await connection.close().catch(() => undefined); this.media.release(); throw error; }
  }
  private async connected(callId: string): Promise<void> { const session = await this.require(callId); if (session.state === 'connecting') await this.calls.service.event(callId, 'connected'); }
  private async fail(callId: string): Promise<void> { callStabilityDiagnostic('failure-handler-entered', 'peer-failed'); const session = await this.calls.service.get(callId); if (session && !['ended', 'failed', 'cancelled', 'rejected', 'expired'].includes(session.state)) await this.calls.service.event(callId, 'fail'); callStabilityDiagnostic('cleanup-trigger', 'peer-failed'); await this.cleanup(callId); }
  private async cleanup(callId: string): Promise<void> { const connection = this.connections.get(callId); this.connections.delete(callId); this.queued.delete(callId); this.remoteDescriptionReady.delete(callId); this.firstRemoteCandidateTimed.delete(callId); await connection?.close(); this.localStreams.delete(callId); this.remoteStreams.delete(callId); this.media.release(); this.mediaListeners.forEach((listener) => listener({ callId })); }
  private async flush(callId: string, connection: CallMediaConnection): Promise<void> { const list = this.queued.get(callId) ?? []; this.queued.delete(callId); for (const item of list) await connection.addIceCandidate(item); }
  private async require(callId: string): Promise<CallSession> { const session = await this.calls.service.get(callId); if (!session || session.expiresAt <= Date.now()) throw new Error('Call has expired.'); return session; }
}
