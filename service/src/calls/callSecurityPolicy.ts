export type CallSecurityPolicy = { invitationLifetimeMs: number; heartbeatTimeoutMs: number; maxParticipants: number; maxSequenceGap: number };
export const DEFAULT_CALL_SECURITY_POLICY: Readonly<CallSecurityPolicy> = Object.freeze({ invitationLifetimeMs: 60_000, heartbeatTimeoutMs: 30_000, maxParticipants: 2, maxSequenceGap: 1 });
export const validateCallPolicy = (policy: CallSecurityPolicy): void => {
  if (!Number.isSafeInteger(policy.invitationLifetimeMs) || policy.invitationLifetimeMs < 1_000 || policy.invitationLifetimeMs > 86_400_000) throw new Error('Invalid call invitation lifetime.');
  if (!Number.isSafeInteger(policy.heartbeatTimeoutMs) || policy.heartbeatTimeoutMs < 1_000 || policy.heartbeatTimeoutMs > 300_000) throw new Error('Invalid call heartbeat timeout.');
  if (policy.maxParticipants !== 2 || !Number.isSafeInteger(policy.maxSequenceGap) || policy.maxSequenceGap < 0) throw new Error('Invalid call policy.');
};
