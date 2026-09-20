import type { CallMediaConnection, IceServer } from './webrtc';
import type { CallSession } from './contracts';

export type CaptureKind = 'microphone' | 'camera';
export interface MediaCapture { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>; }
export const browserMediaCapture: MediaCapture = { getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints) };

/** Requests devices only when explicitly called and always releases every track. */
export class CallMediaController {
  private stream?: MediaStream;
  constructor(private readonly capture: MediaCapture = browserMediaCapture) {}
  async request(kind: CaptureKind): Promise<MediaStream> {
    if (this.stream) return this.stream;
    try { this.stream = await this.capture.getUserMedia(kind === 'camera' ? { audio: true, video: true } : { audio: true, video: false }); return this.stream; }
    catch { this.release(); throw new Error('Call media permission was denied.'); }
  }
  release(): void { this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; }
}

type PeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection;
const browserPeerFactory: PeerFactory = (configuration) => new RTCPeerConnection(configuration);

/** Browser WebRTC lifecycle adapter. It has no signaling or storage authority. */
export class BrowserCallMediaConnection implements CallMediaConnection {
  private readonly peer: RTCPeerConnection;
  private readonly listeners = new Set<(state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed') => void>();
  constructor(iceServers: readonly IceServer[], factory: PeerFactory = browserPeerFactory) {
    this.peer = factory({ iceServers: iceServers as RTCIceServer[] });
    this.peer.onconnectionstatechange = () => { const state = this.peer.connectionState; this.listeners.forEach((listener) => listener(state === 'connected' ? 'connected' : state === 'disconnected' ? 'reconnecting' : state === 'closed' ? 'closed' : state === 'failed' ? 'failed' : 'connecting')); };
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> { const offer = await this.peer.createOffer(); await this.peer.setLocalDescription(offer); return offer; }
  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> { await this.peer.setRemoteDescription(offer); const answer = await this.peer.createAnswer(); await this.peer.setLocalDescription(answer); return answer; }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> { await this.peer.addIceCandidate(candidate); }
  addStream(stream: MediaStream): void { stream.getTracks().forEach((track) => this.peer.addTrack(track, stream)); }
  async close(): Promise<void> { this.peer.close(); this.listeners.forEach((listener) => listener('closed')); this.listeners.clear(); }
  onStateChange(listener: (state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export class BrowserCallTransport {
  constructor(private readonly factory: PeerFactory = browserPeerFactory) {}
  async connect(_session: CallSession, config: { iceServers: readonly IceServer[]; iceTransportPolicy?: 'all' | 'relay' }): Promise<BrowserCallMediaConnection> { return new BrowserCallMediaConnection(config.iceServers, this.factory); }
}
