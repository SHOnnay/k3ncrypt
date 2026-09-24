import type { CallMediaConnection, IceServer } from './webrtc';
import type { CallSession } from './contracts';
import { BrowserCaptureController } from '../privacy/capture';

export type CaptureKind = 'microphone' | 'camera';
export interface MediaCapture { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>; }

/** Requests devices only when explicitly called and always releases every track. */
export class CallMediaController {
  private stream?: MediaStream;
  private generation = 0;
  private readonly browserCapture = new BrowserCaptureController();
  private readonly capture: MediaCapture;
  constructor(capture?: MediaCapture) { this.capture = capture ?? { getUserMedia: (constraints) => this.browserCapture.request(constraints) }; }
  async request(kind: CaptureKind): Promise<MediaStream> {
    if (this.stream) return this.stream;
    const generation = ++this.generation;
    try { const stream = await this.capture.getUserMedia(kind === 'camera' ? { audio: true, video: true } : { audio: true, video: false }); if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Cancelled'); } this.stream = stream; return stream; }
    catch { this.release(); throw new Error('Call media permission was denied.'); }
  }
  get activeStream(): MediaStream | undefined { return this.stream; }
  setMicrophoneEnabled(enabled: boolean): void { this.stream?.getAudioTracks().forEach((track) => { track.enabled = enabled; }); }
  setCameraEnabled(enabled: boolean): void { this.stream?.getVideoTracks().forEach((track) => { track.enabled = enabled; }); }
  async switchCamera(): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track?.applyConstraints) return false;
    const current = track.getSettings?.().facingMode;
    await track.applyConstraints({ facingMode: current === 'user' ? 'environment' : 'user' });
    return true;
  }
  release(): void { ++this.generation; this.browserCapture.release(); this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; }
}

type PeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection;
const browserPeerFactory: PeerFactory = (configuration) => new RTCPeerConnection(configuration);

/** Browser WebRTC lifecycle adapter. It has no signaling or storage authority. */
export class BrowserCallMediaConnection implements CallMediaConnection {
  private readonly peer: RTCPeerConnection;
  private readonly listeners = new Set<(state: import('./webrtc').CallMediaState) => void>();
  private readonly candidateListeners = new Set<(candidate: unknown) => void>();
  private remoteStream?: MediaStream;
  private readonly remoteListeners = new Set<(stream: MediaStream) => void>();
  constructor(iceServers: readonly IceServer[], factory: PeerFactory = browserPeerFactory, iceTransportPolicy: RTCIceTransportPolicy = 'all') {
    this.peer = factory({ iceServers: iceServers as RTCIceServer[], iceTransportPolicy });
    this.peer.onconnectionstatechange = () => { const state = this.peer.connectionState; this.listeners.forEach((listener) => listener(state === 'connected' ? 'connected' : state === 'disconnected' ? 'reconnecting' : state === 'closed' ? 'closed' : state === 'failed' ? 'failed' : 'connecting')); };
    this.peer.onicecandidate = (event) => { const candidate = event.candidate; if (candidate) this.candidateListeners.forEach((listener) => listener(candidate.toJSON())); };
    this.peer.ontrack = (event) => {
      this.remoteStream ??= new MediaStream();
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!this.remoteStream.getTracks().some((existing) => existing.id === track.id)) this.remoteStream.addTrack(track);
      }
      this.remoteListeners.forEach((listener) => listener(this.remoteStream!));
    };
  }
  async createOffer(restart = false): Promise<RTCSessionDescriptionInit> { const offer = await this.peer.createOffer(restart ? { iceRestart: true } : undefined); await this.peer.setLocalDescription(offer); return offer; }
  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> { await this.peer.setRemoteDescription(offer); const answer = await this.peer.createAnswer(); await this.peer.setLocalDescription(answer); return answer; }
  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> { await this.peer.setRemoteDescription(answer); }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> { await this.peer.addIceCandidate(candidate); }
  addStream(stream: MediaStream): void { stream.getTracks().forEach((track) => this.peer.addTrack(track, stream)); }
  async close(): Promise<void> { this.peer.close(); this.listeners.forEach((listener) => listener('closed')); this.listeners.clear(); this.candidateListeners.clear(); }
  onIceCandidate(listener: (candidate: unknown) => void): () => void { this.candidateListeners.add(listener); return () => this.candidateListeners.delete(listener); }
  onStateChange(listener: (state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onRemoteStream(listener: (stream: MediaStream) => void): () => void { this.remoteListeners.add(listener); if (this.remoteStream?.getTracks().length) listener(this.remoteStream); return () => this.remoteListeners.delete(listener); }
}

export class BrowserCallTransport {
  constructor(private readonly factory: PeerFactory = browserPeerFactory) {}
  async connect(_session: CallSession, config: { iceServers: readonly IceServer[]; iceTransportPolicy?: 'all' | 'relay' }): Promise<BrowserCallMediaConnection> { return new BrowserCallMediaConnection(config.iceServers, this.factory, config.iceTransportPolicy); }
}
