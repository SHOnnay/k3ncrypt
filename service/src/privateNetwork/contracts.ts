import type { CryptoSession, EncryptedEnvelope } from '../core/contracts';

export type PrivateNetworkMember = { deviceId: string; identityReference: string; role: 'owner' | 'member' | 'bridge'; state: 'active' | 'removed' };
export type PrivateNetworkState = { version: 1; networkId: string; accountScope: string; epoch: number; previousCommitment?: string; commitment: string; members: readonly PrivateNetworkMember[] };
export type PrivateNetworkAuthorization = { version: 1; authorizationId: string; networkId: string; accountScope: string; issuerDeviceId: string; issuerIdentityReference: string; targetDeviceId: string; targetIdentityReference: string; operation: 'join' | 'remove'; role?: PrivateNetworkMember['role']; previousEpoch: number; previousCommitment: string; expiresAt: number; digest: string };
export type PrivateNetworkPacket = { version: 1; networkId: string; senderDeviceId: string; senderIdentityReference: string; receiverDeviceId: string; sessionId: string; messageId: string; expiresAt: number; payload: unknown };
export interface NetworkTrustBoundary { assertTrusted(): Promise<void>; snapshot(): Promise<{ list: { identityReference: string; epoch: number; devices: readonly { deviceId: string; publicIdentityReference: string; state: 'active' | 'revoked' }[] }; commitment: string }>; }
export interface PrivateNetworkPersistence { read(networkId: string): Promise<PrivateNetworkState | undefined>; compareAndSwap(networkId: string, expected: PrivateNetworkState | undefined, next: PrivateNetworkState): Promise<boolean>; claim(networkId: string, key: string, expiresAt: number): Promise<boolean>; }
export interface PrivateNetworkRelay { send(targetDeviceId: string, envelope: EncryptedEnvelope): Promise<void>; onEnvelope(listener: (senderDeviceId: string, envelope: EncryptedEnvelope) => Promise<void>): () => void; }
export interface PrivateNetworkSessionBinding { networkId: string; localDeviceId: string; localIdentityReference: string; peerDeviceId: string; peerIdentityReference: string; sessionId: string; cryptoSession: CryptoSession; }
export type ConnectivityMode = 'lan' | 'internet' | 'relay';
