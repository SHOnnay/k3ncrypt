import type { CallSession } from './contracts';
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type WebRtcConfigProvider = (session: CallSession) => Promise<{ iceServers: readonly IceServer[]; iceTransportPolicy?: 'all' | 'relay' }>;
export type CallMediaState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';
export interface CallMediaConnection { createOffer(restart?: boolean): Promise<unknown>; acceptOffer(offer: unknown): Promise<unknown>; acceptAnswer(answer: unknown): Promise<void>; addIceCandidate(candidate: unknown): Promise<void>; close(): Promise<void>; onIceCandidate(listener: (candidate: unknown) => void): () => void; onStateChange(listener: (state: CallMediaState) => void): () => void; }
export interface CallTransport { connect(session: CallSession, config: Awaited<ReturnType<WebRtcConfigProvider>>): Promise<CallMediaConnection>; }
