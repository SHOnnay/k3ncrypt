import type { CallSession } from './contracts';
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type WebRtcConfigProvider = (session: CallSession) => Promise<{ iceServers: readonly IceServer[]; iceTransportPolicy?: 'all' | 'relay' }>;
export interface CallMediaConnection { createOffer(): Promise<unknown>; acceptOffer(offer: unknown): Promise<unknown>; addIceCandidate(candidate: unknown): Promise<void>; close(): Promise<void>; onStateChange(listener: (state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed') => void): () => void; }
export interface CallTransport { connect(session: CallSession, config: Awaited<ReturnType<WebRtcConfigProvider>>): Promise<CallMediaConnection>; }
