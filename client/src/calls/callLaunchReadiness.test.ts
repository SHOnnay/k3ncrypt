import { callAttemptClearsError, callLaunchBlockMessage, callStartFailureMessage, getCallLaunchBlockReason, terminalCallStatusMessage, terminalCallRetryable, type CallLaunchReadinessInput } from './callLaunchReadiness';

const verifiedConnected: CallLaunchReadinessInput = {
  hasConversation: true,
  protocolMode: 'modern',
  connected: true,
  sessionHealth: 'healthy',
  verification: 'verified',
  changeStatus: 'unchanged',
};

describe('call launch readiness', () => {
  it('allows verified audio and video launch on the same modern call authority', () => {
    expect(getCallLaunchBlockReason(verifiedConnected)).toBeUndefined();
    // Audio and video use this same gate; media intent is passed separately to
    // the existing invite('video') API and never upgrades an audio request.
    expect(getCallLaunchBlockReason({ ...verifiedConnected })).toBeUndefined();
  });

  it('blocks launch when the local contact is unverified or its status is unknown', () => {
    expect(getCallLaunchBlockReason({ ...verifiedConnected, verification: 'unverified' })).toBe('verification-required');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, verification: 'unknown' })).toBe('verification-unavailable');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, verification: undefined })).toBe('verification-unavailable');
  });

  it('blocks launch while the contact identity is changed pending review', () => {
    expect(getCallLaunchBlockReason({ ...verifiedConnected, changeStatus: 'changed-pending-review' })).toBe('identity-change-pending-review');
  });

  it('blocks legacy protocol, disconnected, unhealthy, and busy states with distinct reasons', () => {
    expect(getCallLaunchBlockReason({ ...verifiedConnected, protocolMode: 'legacy' })).toBe('upgrade-required');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, connected: false })).toBe('connection-unavailable');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, sessionHealth: 'renewal-pending' })).toBe('connection-unavailable');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, callInProgress: true })).toBe('call-in-progress');
    expect(getCallLaunchBlockReason({ ...verifiedConnected, hasConversation: false })).toBe('no-conversation');
  });

  it('gives users a distinct verification-required and upgrade-required message', () => {
    expect(callLaunchBlockMessage('verification-required')).toMatch(/Check this contact before calling/);
    expect(callLaunchBlockMessage('identity-change-pending-review')).toMatch(/check the new security number/i);
    expect(callLaunchBlockMessage('upgrade-required')).toMatch(/newer K3NCRYPT version/);
  });

  it('does not mislabel protocol, verification, or permission failures as network failures', () => {
    expect(callStartFailureMessage(new Error('protocol incompatible'), 'video')).toMatch(/newer K3NCRYPT version/);
    expect(callStartFailureMessage(new Error('verification required'), 'audio')).toMatch(/Check this contact before calling/);
    expect(callStartFailureMessage(new Error('camera permission denied'), 'video')).toMatch(/permission was denied/);
    expect(callStartFailureMessage(new Error('microphone unavailable'), 'audio')).toMatch(/Microphone is unavailable/);
  });

  it('keeps ended, failed, rejected, and cancelled results visible after the overlay closes', () => {
    expect(terminalCallStatusMessage('ended')).toBe('Call ended.');
    expect(terminalCallStatusMessage('ice-failed')).toBe('Call failed.');
    expect(terminalCallStatusMessage('rejected')).toBe('Call declined.');
    expect(terminalCallStatusMessage('cancelled')).toBe('Call cancelled.');
    expect(terminalCallStatusMessage('connected')).toBeUndefined();
    // Calls milestone 2: "Ringing…" ends in a plain answer, with Retry where retrying can help.
    expect(terminalCallStatusMessage('timeout', { outgoing: true, name: 'Bob' })).toBe('No answer. Bob may be offline or have K3NCRYPT closed.');
    expect(terminalCallStatusMessage('timeout', { outgoing: false, name: 'Bob' })).toBe('Missed call from Bob.');
    expect(terminalCallRetryable('timeout', true)).toBe(true);
    expect(terminalCallRetryable('timeout', false)).toBe(false);
    expect(terminalCallRetryable('ice-failed', true)).toBe(true);
    expect(terminalCallRetryable('rejected', true)).toBe(false);
  });
});

// M3c: classification follows the error code, never the wording.
describe('call failures are classified by code', () => {
  it('maps coded errors regardless of their message text', () => {
    const coded = (code: string) => Object.assign(new Error('wording that mentions nothing relevant'), { safeDiagnosticCode: code });
    expect(callStartFailureMessage(coded('VERIFICATION_REQUIRED'), 'audio')).toBe('Check this contact before calling.');
    expect(callStartFailureMessage(coded('PINNED_IDENTITY_CHANGED'), 'audio')).toBe('Calls are paused until you check the new security number.');
    expect(callStartFailureMessage(coded('RECIPIENT_AUTHORITY_CHANGED'), 'video')).toBe('Calls are paused until you check the new security number.');
  });
  it('a code wins over misleading text', () => {
    const error = Object.assign(new Error('microphone permission denied'), { safeDiagnosticCode: 'VERIFICATION_REQUIRED' });
    expect(callStartFailureMessage(error, 'audio')).toBe('Check this contact before calling.');
  });
});

describe('callAttemptClearsError', () => {
  it('clears on a new attempt, never during a live call or after a failure', () => {
    for (const state of ['inviting', 'ringing', 'connecting']) expect(callAttemptClearsError(state)).toBe(true);
    for (const state of ['connected', 'media-failed', 'ended', undefined]) expect(callAttemptClearsError(state)).toBe(false);
  });
});
