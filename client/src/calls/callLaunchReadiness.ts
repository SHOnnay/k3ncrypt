import type { CallLifecycleState } from '@chat-e2ee/service';

export type CallLaunchBlockReason =
  | 'no-conversation'
  | 'upgrade-required'
  | 'identity-change-pending-review'
  | 'verification-unavailable'
  | 'verification-required'
  | 'connection-unavailable'
  | 'call-in-progress';

export interface CallLaunchReadinessInput {
  hasConversation: boolean;
  protocolMode: 'legacy' | 'modern';
  connected: boolean;
  sessionHealth: 'healthy' | 'unhealthy' | 'renewal-pending';
  verification?: 'unknown' | 'unverified' | 'verified';
  changeStatus?: 'unchanged' | 'changed-pending-review';
  callInProgress?: boolean;
}

/** Calls require the locally authoritative identity and a healthy modern session. */
export const getCallLaunchBlockReason = (input: CallLaunchReadinessInput): CallLaunchBlockReason | undefined => {
  if (!input.hasConversation) return 'no-conversation';
  if (input.protocolMode === 'legacy') return 'upgrade-required';
  if (input.changeStatus === 'changed-pending-review') return 'identity-change-pending-review';
  if (input.changeStatus !== 'unchanged' || input.verification === undefined || input.verification === 'unknown') {
    return 'verification-unavailable';
  }
  if (input.verification !== 'verified') return 'verification-required';
  if (!input.connected || input.sessionHealth !== 'healthy') return 'connection-unavailable';
  if (input.callInProgress) return 'call-in-progress';
  return undefined;
};

export const callLaunchBlockMessage = (reason: CallLaunchBlockReason): string => {
  switch (reason) {
    case 'no-conversation': return 'Open a checked contact’s chat to call.';
    case 'upgrade-required': return 'Call requires a newer K3NCRYPT version.';
    case 'identity-change-pending-review': return 'Calls are paused until you check the new security number.';
    case 'verification-unavailable': return 'Open this chat again to call. K3NCRYPT couldn’t confirm the check right now.';
    case 'verification-required': return 'Check this contact before calling.';
    case 'connection-unavailable': return 'Waiting to connect. Try the call again in a moment.';
    case 'call-in-progress': return 'A call is already in progress.';
  }
};

/** M3c: classify by the error's safeDiagnosticCode first; message text is only a fallback for untagged errors. */
export const checkFailureKind = (error: unknown): 'check-required' | 'number-changed' | undefined => {
  const code = error && typeof error === 'object' ? (error as { safeDiagnosticCode?: unknown }).safeDiagnosticCode : undefined;
  if (code === 'PINNED_IDENTITY_CHANGED') return 'number-changed';
  if (code === 'VERIFICATION_REQUIRED' || code === 'RECIPIENT_AUTHORITY_CHANGED' || code === 'RECIPIENT_AUTHORITY_MISSING') return code === 'RECIPIENT_AUTHORITY_CHANGED' ? 'number-changed' : 'check-required';
  return undefined;
};
export const CHECK_BEFORE_CALLING = 'Check this contact before calling.';
export const CALLS_PAUSED_NUMBER_CHANGED = 'Calls are paused until you check the new security number.';

export const callStartFailureMessage = (error: unknown, media: 'audio' | 'video'): string => {
  const kind = checkFailureKind(error);
  if (kind === 'number-changed') return CALLS_PAUSED_NUMBER_CHANGED;
  if (kind === 'check-required') return CHECK_BEFORE_CALLING;
  const source = error instanceof Error ? error.message.toLowerCase() : '';
  if (source.includes('protocol') || source.includes('newer') || source.includes('incompatible')) {
    return 'Call requires a newer K3NCRYPT version.';
  }
  // Fallback for untagged (legacy) errors only.
  if (source.includes('verification') || source.includes('identity') || source.includes('review')) return CHECK_BEFORE_CALLING;
  if (source.includes('permission') || source.includes('denied') || source.includes('dismissed')) {
    return media === 'video'
      ? 'Camera or microphone permission was denied or dismissed. Allow the required permission and retry.'
      : 'Microphone permission was denied or dismissed. Allow it and retry.';
  }
  if (source.includes('camera')) return 'Camera is unavailable. Check it and retry the video call.';
  if (source.includes('microphone')) return 'Microphone is unavailable. Check it and retry the call.';
  if (source.includes('media') || source.includes('capture') || source.includes('device')) {
    return 'Call media is unavailable. Check the required device and retry.';
  }
  return 'Call could not start. Check your connection and try again.';
};

export const terminalCallStatusMessage = (state: CallLifecycleState, call?: { outgoing: boolean; name: string }): string | undefined => {
  if (state === 'timeout' && call) return call.outgoing ? `No answer. ${call.name} may be offline or have K3NCRYPT closed.` : `Missed call from ${call.name}.`;
  switch (state) {
    case 'ended': return 'Call ended.';
    case 'rejected': return 'Call declined.';
    case 'cancelled': return 'Call cancelled.';
    case 'timeout': return 'Call timed out.';
    case 'no-peer': return 'Contact unavailable for a call.';
    case 'media-denied': return 'Call ended because media permission was denied.';
    case 'media-failed': return 'Call ended because required media was unavailable.';
    case 'signaling-failed': return 'The call could not connect. Check your connection and try again.';
    case 'ice-failed': return 'Call failed.';
    default: return undefined;
  }
};

/** Calls milestone 2: the outcomes where calling again can help; only the caller retries a timed-out call. */
export const terminalCallRetryable = (state: CallLifecycleState, outgoing: boolean): boolean =>
  ['ice-failed', 'signaling-failed', 'media-failed'].includes(state) || (state === 'timeout' && outgoing);
