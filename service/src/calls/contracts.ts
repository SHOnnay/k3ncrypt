export type CallState = 'idle' | 'inviting' | 'ringing' | 'accepted' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'rejected' | 'cancelled' | 'expired' | 'failed';
export type CallParticipant = { participantId: string; identityId: string; verification: 'unknown' | 'unverified' | 'verified' | 'changed-pending-review' };
export type CallSession = { callId: string; conversationId: string; participants: readonly [CallParticipant, CallParticipant]; state: CallState; createdAt: number; updatedAt: number; expiresAt: number; identityBinding: string };
export type CallEvent = 'invite' | 'accept' | 'reject' | 'cancel' | 'connect' | 'connected' | 'reconnect' | 'end' | 'expire' | 'fail' | 'heartbeat';
export type PermissionState = 'unknown' | 'requested' | 'granted' | 'active' | 'released' | 'denied';
export type CallPermissions = { microphone: PermissionState; camera: PermissionState };

export interface CallIdentityVerifier {
  isParticipant(conversationId: string, participantId: string): Promise<boolean>;
  getVerification(participantId: string): Promise<CallParticipant['verification']>;
  identityBinding(conversationId: string, participants: readonly [CallParticipant, CallParticipant]): Promise<string>;
}

export interface CallSignal { callId: string; conversationId: string; sender: CallParticipant; event: Exclude<CallEvent, 'heartbeat'>; sequence: number; expiresAt: number; identityBinding: string; }
export interface CallSignalTransport { send(signal: CallSignal): Promise<void>; onSignal(listener: (signal: CallSignal) => Promise<void>): () => void; }
