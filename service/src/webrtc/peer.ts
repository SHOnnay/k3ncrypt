import { Logger } from "../utils/logger";
import { generateUUID } from "../utils/uuid";
import {
    type callEvents,
    type WebRtcSignalPayload,
    type OfferSignalData,
    type AnswerSignalData,
    type IceCandidateSignalWithMetadata,
    type SignalMetadata,
} from "./types";
import { AudioSink } from "./audioSink";
import type { WebRtcConfig } from '../public/types';
import { BrowserCaptureController } from '../privacy/capture';

/**
 * Seals and sends a signaling payload (offer/answer/ICE candidate/call
 * control) over the socket connection. Provided by the SDK facade so `Peer`
 * never needs to know about encryption keys or the room id — it only knows
 * how to hand a payload off.
 */
export type SignalSender = (signal: WebRtcSignalPayload) => Promise<void>;
export type CallMediaKind = 'audio' | 'video';

export class Peer {
    private readonly capture = new BrowserCaptureController();
    private state: RTCPeerConnectionState;
    private pc: RTCPeerConnection;

    private audioSink: AudioSink;
    private audioStream?: MediaStream;
    private remoteStream?: MediaStream;
    private fallbackSignalSeq = 0;
    private fallbackCallId = generateUUID();
    private readonly mediaKind: CallMediaKind;

    private localStreamAcquisatonPromise?: Promise<void>
    constructor(
        private subCtx: () => Map<callEvents, Set<Function>>,
        private sendSignal: SignalSender,
        private logger: Logger,
        private signalMetadataProvider?: () => SignalMetadata,
        private rtcConfig: WebRtcConfig = { iceServers: [], iceTransportPolicy: 'all' },
        mediaKind: CallMediaKind = 'audio',
    ) {
        this.mediaKind = mediaKind;
        this.audioSink = new AudioSink(this.logger.createChild('AudioSink'));

        // Media is protected exclusively by WebRTC's mandatory DTLS-SRTP
        // transport encryption; no custom per-frame encryption is layered on
        // top (see the signaling envelope for the E2E-encrypted layer).
        this.pc = new RTCPeerConnection({
            iceServers: this.rtcConfig.iceServers ?? [],
            iceTransportPolicy: this.rtcConfig.iceTransportPolicy ?? 'all',
        });

        this.pc.onconnectionstatechange = () => {
            this.logger.log('Peer Connection State: ', this.pc.connectionState);
            this.state = this.pc.connectionState;
            const sub = this.subCtx();
            const stateChangeHanlder = sub.get('state-changed');
            stateChangeHanlder?.forEach(cb => cb(this.state));
        };

        this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            if (event.candidate) {
                this.logger.log('ICE Candidate (Caller) gathered.');
                const metadata = this.resolveSignalMetadata();
                const signal: IceCandidateSignalWithMetadata = {
                    candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
                    type: 'candidate',
                    ...metadata,
                };
                this.sendSignal(signal).catch((error) => this.logger.log('Failed to send ICE candidate:', error));
            }
        };

        this.pc.ontrack = (event: RTCTrackEvent) => {
            this.remoteStream = event.streams[0];
            event.streams[0].getAudioTracks().forEach(() => {
                this.logger.log('Adding remote audio track');
                this.audioSink.attach(event.streams[0], 'remote');
            })
        };

        this.state = this.pc.connectionState;
        this.localStreamAcquisatonPromise = this.addLocalAudioTracks();
    }

    public get callState(): RTCPeerConnectionState {
        return this.state;
    }

    public setMicrophoneEnabled(enabled: boolean): void { this.audioStream?.getAudioTracks().forEach((track) => { track.enabled = enabled; }); }
    public setCameraEnabled(enabled: boolean): void { this.audioStream?.getVideoTracks().forEach((track) => { track.enabled = enabled; }); }
    public get localStream(): MediaStream | undefined { return this.audioStream; }
    public getRemoteStream(): MediaStream | undefined { return this.remoteStream; }

    public async createAndSendOffer() {
        await this.localStreamAcquisatonPromise;
        this.logger.log('createAndSendOffer');
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        const metadata = this.resolveSignalMetadata();
        const signal: OfferSignalData = {
            type: 'offer',
            sdp: offer.sdp || '',
            ...metadata,
        };
        await this.sendSignal(signal);
    }


    public async signal(data: WebRtcSignalPayload) {
        if (data.type === 'offer') {
            await this.localStreamAcquisatonPromise;
            this.logger.log('Signal, offer');
            await this.pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            const metadata = this.resolveSignalMetadata();
            const signal: AnswerSignalData = {
                type: 'answer',
                sdp: answer.sdp || '',
                ...metadata,
            };
            await this.sendSignal(signal);
        } else if (data.type === 'answer') {
            this.logger.log('Signal, answer');
            await this.pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (data.type === 'candidate') {
            this.logger.log('Signal, candidate');
            const candidate = new RTCIceCandidate(data.candidate);
            this.pc.addIceCandidate(candidate).catch(() => this.logger.log('Unable to add ICE candidate'));
        }
    }

    public dispose(): void {
        this.capture.release();
        if(this.audioStream) {
            this.audioStream.getTracks().forEach(track => {
                track.stop() ;
            });
            this.audioStream = undefined;
        }
        this.audioSink.detach();
        this.remoteStream = undefined;
        this.logger.log('Dispose');
        this.pc?.close();
        this.pc = undefined as unknown as RTCPeerConnection;
    }

    private async addLocalAudioTracks(): Promise<void> {
        this.logger.log('addLocalAudioTracks, adding local track to Peer Connection');
        this.audioStream = await this.getAudioStream();
        this.audioStream.getTracks().forEach(track => this.pc.addTrack(track, this.audioStream!));
    }

    private async getAudioStream(): Promise<MediaStream> {
        this.logger.log('getAudioStream');
        return this.capture.request({ audio: true, video: this.mediaKind === 'video' });
    }

    private resolveSignalMetadata(): SignalMetadata {
        if (this.signalMetadataProvider) {
            return this.signalMetadataProvider();
        }
        return {
            callId: this.fallbackCallId,
            seq: ++this.fallbackSignalSeq,
            timestamp: Date.now(),
        };
    }
}
