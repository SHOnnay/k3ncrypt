import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { CallMediaConnection, IceServer } from './webrtc';
import type { CallSession } from './contracts';
import { BrowserCaptureController, BrowserCaptureError } from '../privacy/capture';
import { beginIceTimingTrace, traceIceHealthSnapshot, traceIceTiming } from './iceTiming';

export type CaptureKind = 'microphone' | 'camera';
export type LocalTrackKind = 'audio' | 'video';
export type LocalMediaFailure = 'microphone-unavailable' | 'camera-unavailable';
export interface MediaCapture { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>; }

const captureFailureMessage = (kind: CaptureKind, error: unknown): string => {
  const reason = error instanceof BrowserCaptureError ? error.reason
    : error && typeof error === 'object' && 'name' in error
      ? ({ NotAllowedError: 'permission-denied', PermissionDeniedError: 'permission-denied', SecurityError: 'permission-denied', NotFoundError: 'device-unavailable', DevicesNotFoundError: 'device-unavailable', OverconstrainedError: 'device-unavailable', NotReadableError: 'device-busy', TrackStartError: 'device-busy', AbortError: 'request-dismissed', InvalidStateError: 'request-dismissed' } as Record<string, string>)[String((error as { name?: unknown }).name)] ?? 'capture-unavailable'
      : 'capture-unavailable';
  if (reason === 'permission-denied' || reason === 'request-dismissed') return kind === 'camera'
    ? 'Camera or microphone permission was denied or dismissed. Allow both permissions and try again.'
    : 'Microphone permission was denied or dismissed. Allow microphone access and try again.';
  if (reason === 'device-unavailable') return kind === 'camera' ? 'A camera or microphone is unavailable.' : 'A microphone is unavailable.';
  if (reason === 'device-busy') return kind === 'camera' ? 'The camera or microphone is in use by another app.' : 'The microphone is in use by another app.';
  return 'Call media is unavailable. Check the device and page permissions, then retry.';
};

/** Requests devices only after acceptance/peer acceptance, and releases every track on call cleanup. */
export class CallMediaController {
  private stream?: MediaStream;
  private generation = 0;
  private readonly browserCapture = new BrowserCaptureController();
  private readonly capture: MediaCapture;
  private readonly trackListeners = new Map<MediaStreamTrack, () => void>();
  private readonly endedListeners = new Set<(kind: LocalTrackKind) => void>();
  constructor(capture?: MediaCapture) { this.capture = capture ?? { getUserMedia: (constraints) => this.browserCapture.request(constraints) }; }
  async request(kind: CaptureKind): Promise<MediaStream> {
    if (this.stream) return this.stream;
    const generation = this.generation;
    try {
      const stream = await this.capture.getUserMedia(kind === 'camera' ? { audio: true, video: true } : { audio: true, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Call media request was cancelled.'); }
      this.stream = stream;
      this.watchTracks(stream);
      return stream;
    } catch (error) {
      if (generation === this.generation) this.release();
      throw new Error(captureFailureMessage(kind, error));
    }
  }
  get activeStream(): MediaStream | undefined { return this.stream; }
  setMicrophoneEnabled(enabled: boolean): void { this.stream?.getAudioTracks().forEach((track) => { if (track.readyState === 'live') track.enabled = enabled; }); }
  async setCameraEnabled(enabled: boolean): Promise<MediaStreamTrack | undefined> {
    if (!this.stream) throw new Error('Call media is not active.');
    const current = this.stream.getVideoTracks().find((track) => track.readyState === 'live');
    if (!enabled) {
      if (!current) return undefined;
      current.enabled = false;
      this.unwatchTrack(current);
      this.stream.removeTrack(current);
      current.stop();
      return undefined;
    }
    if (current) { current.enabled = true; return current; }
    for (const stale of this.stream.getVideoTracks()) { this.unwatchTrack(stale); this.stream.removeTrack(stale); }
    const generation = this.generation;
    let replacement: MediaStream | undefined;
    try {
      replacement = await this.capture.getUserMedia({ audio: false, video: true });
      const track = replacement.getVideoTracks().find((item) => item.readyState === 'live');
      if (!track) throw new Error('Camera device unavailable.');
      if (generation !== this.generation || !this.stream) { replacement.getTracks().forEach((item) => item.stop()); throw new Error('Camera request was cancelled.'); }
      this.stream.addTrack(track);
      this.watchTrack(track);
      return track;
    } catch (error) {
      replacement?.getTracks().forEach((track) => { if (track.readyState === 'live') track.stop(); });
      throw new Error(captureFailureMessage('camera', error));
    }
  }
  async switchCamera(): Promise<boolean> {
    const track = this.stream?.getVideoTracks().find((item) => item.readyState === 'live');
    if (!track?.applyConstraints) return false;
    const current = track.getSettings?.().facingMode;
    try { await track.applyConstraints({ facingMode: current === 'user' ? 'environment' : 'user' }); return true; }
    catch { return false; }
  }
  onTrackEnded(listener: (kind: LocalTrackKind) => void): () => void { this.endedListeners.add(listener); return () => this.endedListeners.delete(listener); }
  release(): void {
    ++this.generation;
    for (const track of this.trackListeners.keys()) this.unwatchTrack(track);
    this.browserCapture.release();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  private watchTracks(stream: MediaStream): void { stream.getTracks().forEach((track) => this.watchTrack(track)); }
  private watchTrack(track: MediaStreamTrack): void {
    if (this.trackListeners.has(track)) return;
    const ended = (): void => {
      if (track.kind === 'video' && this.stream?.getTracks().includes(track)) { this.unwatchTrack(track); this.stream.removeTrack(track); }
      this.endedListeners.forEach((listener) => listener(track.kind === 'video' ? 'video' : 'audio'));
    };
    track.addEventListener?.('ended', ended);
    this.trackListeners.set(track, () => track.removeEventListener?.('ended', ended));
  }
  private unwatchTrack(track: MediaStreamTrack): void { this.trackListeners.get(track)?.(); this.trackListeners.delete(track); }
}

type PeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection;
const browserPeerFactory: PeerFactory = (configuration) => new RTCPeerConnection(configuration);
const remoteAudioDiagnostic = (stage: 'remote-audio-track-received' | 'remote-audio-ontrack-fired' | 'remote-audio-stream-stored', trackCount: number): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined') return;
  const root = document.documentElement;
  const prior = root.dataset.k3ncryptAudioTrace?.split(',').filter(Boolean) ?? [];
  if (prior.length < 30) prior.push(stage);
  root.dataset.k3ncryptAudioTrace = prior.join(',');
  console.info(`k3ncrypt-call-audio:${stage}`, { trackCount });
};

const callStateDiagnostic = (stage: 'peer-connection-state' | 'ice-connection-state' | 'signaling-state', state: string): void => {
  if (!testDiagnosticsEnabled()) return;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const prior = root.dataset.k3ncryptCallStabilityTrace?.split(',').filter(Boolean) ?? [];
    if (prior.length < 80) prior.push(`${stage}:${state}`);
    root.dataset.k3ncryptCallStabilityTrace = prior.join(',');
  }
  console.info(`k3ncrypt-call-stability:${stage}`, { state });
};

const iceDiagnostic = (stage: string): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined') return;
  const allowed = /^(ice-(local-candidate|remote-candidate|selected-local|selected-remote)-(host|srflx|relay|prflx|unknown)(-(received|added|rejected|relay-acknowledged|relay-failed))?|ice-(gathering-complete|candidate-pair-selected|candidate-pair-not-selected|failure-no-selected-pair|failure-selected-pair-not-connected|candidate-add-failed|state-(new|checking|connected|completed|disconnected|failed|closed)))$/;
  if (!allowed.test(stage)) return;
  const root = document.documentElement;
  const prior = root.dataset.k3ncryptIceTrace?.split(',').filter(Boolean) ?? [];
  if (prior.length < 160) prior.push(stage);
  root.dataset.k3ncryptIceTrace = prior.join(',');
  console.info(`k3ncrypt-call-ice:${stage}`);
};

const candidateType = (value: string | null | undefined): 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown' =>
  value === 'host' || value === 'srflx' || value === 'relay' || value === 'prflx' ? value : 'unknown';

/** Browser WebRTC lifecycle adapter. It has no signaling or storage authority. */
export class BrowserCallMediaConnection implements CallMediaConnection {
  private readonly peer: RTCPeerConnection;
  private firstLocalCandidateTimed = false;
  private selectedPairTimed = false;
  private healthPoll?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<(state: import('./webrtc').CallMediaState) => void>();
  private readonly candidateListeners = new Set<(candidate: unknown) => void>();
  private remoteStream?: MediaStream;
  private readonly remoteListeners = new Set<(stream: MediaStream) => void>();
  private readonly senders = new Map<'audio' | 'video', RTCRtpSender>();
  private readonly remoteEndedListeners = new WeakMap<MediaStreamTrack, () => void>();
  private closed = false;
  constructor(iceServers: readonly IceServer[], factory: PeerFactory = browserPeerFactory, iceTransportPolicy: RTCIceTransportPolicy = 'all') {
    beginIceTimingTrace();
    traceIceTiming('peer-connection-create-start');
    this.peer = factory({ iceServers: iceServers as RTCIceServer[], iceTransportPolicy });
    traceIceTiming('peer-connection-created');
    this.peer.onconnectionstatechange = () => { const state = this.peer.connectionState; callStateDiagnostic('peer-connection-state', state); this.listeners.forEach((listener) => listener(state === 'connected' ? 'connected' : state === 'disconnected' ? 'reconnecting' : state === 'closed' ? 'closed' : state === 'failed' ? 'failed' : 'connecting')); };
    this.peer.oniceconnectionstatechange = () => {
      const state = this.peer.iceConnectionState;
      callStateDiagnostic('ice-connection-state', state);
      iceDiagnostic(`ice-state-${state}`);
      if (state === 'checking') traceIceTiming('ice-checking-start');
      if (state === 'connected' || state === 'completed') traceIceTiming('ice-connected');
      if (state === 'disconnected') traceIceTiming('ice-disconnected');
      if (state === 'failed') traceIceTiming('ice-failure');
      if (state === 'connected' || state === 'completed' || state === 'disconnected' || state === 'failed') void this.collectSelectedCandidatePair(state === 'failed');
      if (state === 'connected' || state === 'completed') this.startHealthPolling();
      if (state === 'disconnected' || state === 'failed' || state === 'closed') this.sampleHealth();
    };
    this.peer.onsignalingstatechange = () => callStateDiagnostic('signaling-state', this.peer.signalingState);
    this.peer.onicegatheringstatechange = () => {
      if (this.peer.iceGatheringState === 'gathering') traceIceTiming('ice-gathering-start');
      if (this.peer.iceGatheringState === 'complete') { traceIceTiming('ice-gathering-complete'); iceDiagnostic('ice-gathering-complete'); }
    };
    this.peer.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate) { traceIceTiming('ice-gathering-complete'); iceDiagnostic('ice-gathering-complete'); return; }
      if (!this.firstLocalCandidateTimed) { this.firstLocalCandidateTimed = true; traceIceTiming('first-local-candidate'); }
      iceDiagnostic(`ice-local-candidate-${candidateType(candidate.type)}`);
      this.candidateListeners.forEach((listener) => listener(candidate.toJSON()));
    };
    this.peer.ontrack = (event) => {
      if (this.closed) return;
      if (event.track.kind === 'audio') remoteAudioDiagnostic('remote-audio-track-received', 1);
      remoteAudioDiagnostic('remote-audio-ontrack-fired', event.track.kind === 'audio' ? 1 : 0);
      this.remoteStream ??= new MediaStream();
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!this.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
          this.remoteStream.addTrack(track);
          const ended = (): void => {
            this.remoteStream?.removeTrack(track);
            if (this.remoteStream) this.remoteListeners.forEach((listener) => listener(this.remoteStream!));
          };
          track.addEventListener?.('ended', ended, { once: true });
          this.remoteEndedListeners.set(track, ended);
        }
      }
      if (event.track.kind === 'audio') remoteAudioDiagnostic('remote-audio-stream-stored', this.remoteStream.getAudioTracks().length);
      this.remoteListeners.forEach((listener) => listener(this.remoteStream!));
    };
  }
  async createOffer(restart = false): Promise<RTCSessionDescriptionInit> {
    const offer = await this.peer.createOffer(restart ? { iceRestart: true } : undefined);
    traceIceTiming('set-local-description-start');
    try { await this.peer.setLocalDescription(offer); traceIceTiming('set-local-description-complete'); }
    catch (error) { traceIceTiming('set-local-description-failed'); throw error; }
    return offer;
  }
  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    traceIceTiming('set-remote-description-start');
    try { await this.peer.setRemoteDescription(offer); traceIceTiming('set-remote-description-complete'); }
    catch (error) { traceIceTiming('set-remote-description-failed'); throw error; }
    const answer = await this.peer.createAnswer();
    traceIceTiming('set-local-description-start');
    try { await this.peer.setLocalDescription(answer); traceIceTiming('set-local-description-complete'); }
    catch (error) { traceIceTiming('set-local-description-failed'); throw error; }
    return answer;
  }
  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    traceIceTiming('set-remote-description-start');
    try { await this.peer.setRemoteDescription(answer); traceIceTiming('set-remote-description-complete'); }
    catch (error) { traceIceTiming('set-remote-description-failed'); throw error; }
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try { await this.peer.addIceCandidate(candidate); traceIceTiming('add-ice-candidate-succeeded'); iceDiagnostic(`ice-remote-candidate-${candidateType(candidate.candidate?.match(/\btyp\s+(host|srflx|relay|prflx)\b/)?.[1])}-added`); }
    catch { traceIceTiming('add-ice-candidate-failed'); iceDiagnostic('ice-candidate-add-failed'); throw new Error('WebRTC candidate rejected.'); }
  }

  private async collectSelectedCandidatePair(failure: boolean): Promise<void> {
    try {
      const report = await this.peer.getStats();
      const stats: RTCStats[] = [];
      report.forEach((item) => stats.push(item));
      const selectedIds = new Set(stats.filter((item) => item.type === 'transport').map((item) => (item as RTCStats & { selectedCandidatePairId?: string }).selectedCandidatePairId).filter((id): id is string => !!id));
      const pairs = stats.filter((item) => item.type === 'candidate-pair') as Array<RTCIceCandidatePairStats & { selected?: boolean }>;
      const selected = pairs.find((item) => selectedIds.has(item.id)) ?? pairs.find((item) => item.selected === true) ?? pairs.find((item) => item.state === 'succeeded' && item.nominated);
      if (!selected) {
        if (failure) traceIceTiming('candidate-pair-not-selected');
        iceDiagnostic('ice-candidate-pair-not-selected');
        if (failure) iceDiagnostic('ice-failure-no-selected-pair');
        return;
      }
      if (!this.selectedPairTimed) { this.selectedPairTimed = true; traceIceTiming('candidate-pair-selected'); }
      iceDiagnostic('ice-candidate-pair-selected');
      const localCandidate = stats.find((item) => item.id === selected.localCandidateId && item.type === 'local-candidate') as (RTCStats & { candidateType?: string }) | undefined;
      const remoteCandidate = stats.find((item) => item.id === selected.remoteCandidateId && item.type === 'remote-candidate') as (RTCStats & { candidateType?: string }) | undefined;
      const localType = candidateType(localCandidate?.candidateType);
      const remoteType = candidateType(remoteCandidate?.candidateType);
      iceDiagnostic(`ice-selected-local-${localType}`);
      iceDiagnostic(`ice-selected-remote-${remoteType}`);
      if (failure) iceDiagnostic('ice-failure-selected-pair-not-connected');
    } catch { if (failure) iceDiagnostic('ice-failure-no-selected-pair'); }
  }
  private startHealthPolling(): void {
    if (!testDiagnosticsEnabled()) return;
    if (this.healthPoll) return;
    this.sampleHealth();
    this.healthPoll = setInterval(() => this.sampleHealth(), 10_000);
  }
  private sampleHealth(): void {
    if (!testDiagnosticsEnabled()) return;
    void this.peer.getStats().then((report) => {
      const stats: RTCStats[] = [];
      report.forEach((item) => stats.push(item));
      const transport = stats.find((item) => item.type === 'transport') as (RTCStats & { selectedCandidatePairId?: string }) | undefined;
      const pairs = stats.filter((item) => item.type === 'candidate-pair') as Array<RTCIceCandidatePairStats & { selected?: boolean; consentRequestsSent?: number; responsesReceived?: number }>;
      const selected = pairs.find((item) => item.id === transport?.selectedCandidatePairId) ?? pairs.find((item) => item.selected === true);
      const selectedPair = selected ? (selected.state === 'succeeded' && selected.nominated ? 'active' : 'inactive') : 'unknown';
      const consentSent = Number.isSafeInteger(selected?.consentRequestsSent) ? selected!.consentRequestsSent! : null;
      const consentReplies = Number.isSafeInteger(selected?.responsesReceived) ? selected!.responsesReceived! : null;
      const rtp = stats.filter((item) => item.type === 'inbound-rtp' || item.type === 'outbound-rtp') as Array<RTCStats & { kind?: string; mediaType?: string; packetsReceived?: number; packetsSent?: number; bytesReceived?: number; bytesSent?: number }>;
      const audio = rtp.filter((item) => item.kind === 'audio' || item.mediaType === 'audio');
      const total = (items: typeof audio, key: 'packetsReceived' | 'packetsSent' | 'bytesReceived' | 'bytesSent'): number => items.reduce((sum, item) => sum + (Number.isSafeInteger(item[key]) ? item[key]! : 0), 0);
      traceIceHealthSnapshot({
        peerState: this.peer.connectionState,
        iceState: this.peer.iceConnectionState,
        signalingState: this.peer.signalingState,
        pageVisibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
        selectedPair,
        consentRequestsSent: consentSent,
        consentResponsesReceived: consentReplies,
        audioInboundPackets: total(audio.filter((item) => item.type === 'inbound-rtp'), 'packetsReceived'),
        audioInboundBytes: total(audio.filter((item) => item.type === 'inbound-rtp'), 'bytesReceived'),
        audioOutboundPackets: total(audio.filter((item) => item.type === 'outbound-rtp'), 'packetsSent'),
        audioOutboundBytes: total(audio.filter((item) => item.type === 'outbound-rtp'), 'bytesSent'),
      });
    }).catch(() => undefined);
  }
  addStream(stream: MediaStream): void { stream.getTracks().forEach((track) => this.senders.set(track.kind === 'video' ? 'video' : 'audio', this.peer.addTrack(track, stream))); }
  async replaceLocalTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void> {
    const sender = this.senders.get(kind);
    if (!sender) { if (track) throw new Error('Call media sender is unavailable.'); return; }
    await sender.replaceTrack(track);
  }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; if (this.healthPoll) clearInterval(this.healthPoll); this.healthPoll = undefined; traceIceTiming('peer-connection-closed'); this.peer.ontrack = null; this.peer.close(); this.remoteStream?.getTracks().forEach((track) => { const ended = this.remoteEndedListeners.get(track); if (ended) track.removeEventListener?.('ended', ended); track.stop(); }); this.remoteStream = undefined; this.remoteListeners.clear(); this.listeners.forEach((listener) => listener('closed')); this.listeners.clear(); this.candidateListeners.clear(); this.senders.clear(); }
  onIceCandidate(listener: (candidate: unknown) => void): () => void { this.candidateListeners.add(listener); return () => this.candidateListeners.delete(listener); }
  onStateChange(listener: (state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onRemoteStream(listener: (stream: MediaStream) => void): () => void { this.remoteListeners.add(listener); if (this.remoteStream?.getTracks().length) listener(this.remoteStream); return () => this.remoteListeners.delete(listener); }
}

export class BrowserCallTransport {
  constructor(private readonly factory: PeerFactory = browserPeerFactory) {}
  async connect(_session: CallSession, config: { iceServers: readonly IceServer[]; iceTransportPolicy?: 'all' | 'relay' }): Promise<BrowserCallMediaConnection> { return new BrowserCallMediaConnection(config.iceServers, this.factory, config.iceTransportPolicy); }
}
