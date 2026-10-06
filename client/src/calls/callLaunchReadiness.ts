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
    case 'no-conversation': return 'Open a verified conversation to call.';
    case 'upgrade-required': return 'Call requires a newer K3NCRYPT version.';
    case 'identity-change-pending-review': return 'Identity changed. K3NCRYPT can’t confirm this is the same person or device anymore. Review the new security code before calling.';
    case 'verification-unavailable': return 'K3NCRYPT could not check this contact’s verification. Review the contact before calling.';
    case 'verification-required': return 'Verify this contact before calling.';
    case 'connection-unavailable': return 'Reconnect to this verified contact before calling.';
    case 'call-in-progress': return 'A call is already in progress.';
  }
};

export const callStartFailureMessage = (error: unknown, media: 'audio' | 'video'): string => {
  const source = error instanceof Error ? error.message.toLowerCase() : '';
  if (source.includes('protocol') || source.includes('newer') || source.includes('incompatible')) {
    return 'Call requires a newer K3NCRYPT version.';
  }
  if (source.includes('verification') || source.includes('identity') || source.includes('review')) {
    return 'Verify this contact before calling. Review its security code if it changed.';
  }
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
  return 'Call could not start. Check the verified connection and retry.';
};

export const terminalCallStatusMessage = (state: CallLifecycleState): string | undefined => {
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
