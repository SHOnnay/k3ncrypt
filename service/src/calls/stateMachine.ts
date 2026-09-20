import type { CallEvent, CallSession, CallState } from './contracts';
import { DEFAULT_CALL_SECURITY_POLICY, type CallSecurityPolicy } from './callSecurityPolicy';
const transitions: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
  idle: { invite: 'inviting' }, inviting: { invite: 'ringing', accept: 'accepted', reject: 'rejected', cancel: 'cancelled', expire: 'expired', fail: 'failed' }, ringing: { accept: 'accepted', reject: 'rejected', cancel: 'cancelled', expire: 'expired', fail: 'failed' }, accepted: { connect: 'connecting', cancel: 'cancelled', fail: 'failed' }, connecting: { connected: 'connected', cancel: 'cancelled', fail: 'failed' }, connected: { heartbeat: 'connected', reconnect: 'reconnecting', end: 'ended', fail: 'failed' }, reconnecting: { connect: 'connecting', end: 'ended', fail: 'failed' }, ended: {}, rejected: {}, cancelled: {}, expired: {}, failed: {},
};
export const transitionCall = (session: CallSession, event: CallEvent, now = Date.now(), policy: CallSecurityPolicy = DEFAULT_CALL_SECURITY_POLICY): CallSession => {
  if (event === 'heartbeat') return session.state === 'connected' && now - session.updatedAt <= policy.heartbeatTimeoutMs ? { ...session, updatedAt: now } : session;
  if (now > session.expiresAt && !['ended', 'rejected', 'cancelled', 'expired', 'failed'].includes(session.state)) throw new Error('Call has expired.');
  const next = transitions[session.state][event];
  if (!next) throw new Error(`Invalid call transition: ${session.state} -> ${event}.`);
  return { ...session, state: next, updatedAt: now };
};
