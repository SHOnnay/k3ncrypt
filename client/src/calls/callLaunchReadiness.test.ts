import { callLaunchBlockMessage, callStartFailureMessage, getCallLaunchBlockReason, terminalCallStatusMessage, type CallLaunchReadinessInput } from './callLaunchReadiness';

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
    expect(callLaunchBlockMessage('verification-required')).toMatch(/Verify this contact before calling/);
    expect(callLaunchBlockMessage('identity-change-pending-review')).toMatch(/identity changed/i);
    expect(callLaunchBlockMessage('upgrade-required')).toMatch(/newer K3NCRYPT version/);
  });

  it('does not mislabel protocol, verification, or permission failures as network failures', () => {
    expect(callStartFailureMessage(new Error('protocol incompatible'), 'video')).toMatch(/newer K3NCRYPT version/);
    expect(callStartFailureMessage(new Error('verification required'), 'audio')).toMatch(/Verify this contact before calling/);
    expect(callStartFailureMessage(new Error('camera permission denied'), 'video')).toMatch(/permission was denied/);
    expect(callStartFailureMessage(new Error('microphone unavailable'), 'audio')).toMatch(/Microphone is unavailable/);
  });

  it('keeps ended, failed, rejected, and cancelled results visible after the overlay closes', () => {
    expect(terminalCallStatusMessage('ended')).toBe('Call ended.');
    expect(terminalCallStatusMessage('ice-failed')).toBe('Call failed.');
    expect(terminalCallStatusMessage('rejected')).toBe('Call declined.');
    expect(terminalCallStatusMessage('cancelled')).toBe('Call cancelled.');
    expect(terminalCallStatusMessage('connected')).toBeUndefined();
  });
});
