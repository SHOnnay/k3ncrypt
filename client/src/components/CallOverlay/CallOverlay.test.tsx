import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatContextType } from '../../types';
import { CallOverlay } from './CallOverlay';

const mockUseChat = jest.fn();

jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./CallOverlay.css', () => ({}));
jest.mock('../common/Button.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));
jest.mock('../../utils/ringtone', () => ({ startRingtone: jest.fn(), stopRingtone: jest.fn() }));

const track = (overrides: Partial<MediaStreamTrack> = {}) => ({
  kind: 'video',
  readyState: 'live',
  enabled: true,
  ...overrides,
} as MediaStreamTrack);

const videoStream = (videoTracks: MediaStreamTrack[] = []): MediaStream => ({
  getVideoTracks: () => videoTracks,
} as unknown as MediaStream);

const activeVideoState = {
  callActive: true,
  callStatus: 'Connected',
  isIncomingCall: false,
  callLifecycleState: 'connected',
  callMediaMode: 'video',
  localCallStream: videoStream([track()]),
  remoteCallStream: videoStream([track()]),
  microphoneMuted: false,
  cameraEnabled: true,
  callError: undefined,
  endCall: jest.fn(),
  acceptCall: jest.fn(),
  rejectCall: jest.fn(),
  cancelCall: jest.fn(),
  setMicrophoneMuted: jest.fn(),
  setCameraEnabled: jest.fn(),
  privacyPreferences: { ringtoneEnabled: false },
  conversations: [{ roomId: 'room-1', label: 'Contact' }],
  channelHash: 'room-1',
};

const renderOverlay = (overrides: Record<string, unknown> = {}): string => {
  mockUseChat.mockReturnValue({ ...activeVideoState, ...overrides } as unknown as ChatContextType);
  return renderToStaticMarkup(React.createElement(CallOverlay));
};

const buttonMarkup = (markup: string, label: string): string => {
  const element = markup.match(new RegExp(`<button\\b(?=[^>]*aria-label="${label}")[^>]*>`));
  if (!element) throw new Error(`Missing button: ${label}`);
  return element[0];
};

describe('video call controls and render state', () => {
  it('renders local and remote video with accessible active-call controls', () => {
    const markup = renderOverlay();
    expect(markup).toContain('aria-label="Remote video"');
    expect(markup).toContain('aria-label="Local video preview"');
    expect(buttonMarkup(markup, 'Mute microphone')).toContain('aria-pressed="false"');
    expect(buttonMarkup(markup, 'Turn camera off')).toContain('aria-pressed="true"');
    expect(buttonMarkup(markup, 'End call')).not.toContain('disabled');
  });

  it('reflects mute and camera off/on state using names, pressed state, and visible camera copy', () => {
    const muted = renderOverlay({ microphoneMuted: true, cameraEnabled: false, localCallStream: videoStream([track()]) });
    expect(buttonMarkup(muted, 'Unmute microphone')).toContain('aria-pressed="true"');
    expect(buttonMarkup(muted, 'Turn camera on')).toContain('aria-pressed="false"');
    expect(muted).toContain('Camera off');
    expect(muted).not.toContain('aria-label="Local video preview"');
  });

  it('shows remote waiting and local starting placeholders when tracks are absent', () => {
    const markup = renderOverlay({ localCallStream: undefined, remoteCallStream: undefined });
    expect(markup).toContain('Waiting for remote video');
    expect(markup).toContain('Camera starting…');
    expect(markup).not.toContain('aria-label="Remote video"');
  });

  it('keeps media controls disabled before remote acceptance and lets the caller cancel', () => {
    const markup = renderOverlay({ callLifecycleState: 'ringing', callStatus: 'Ringing...' });
    expect(buttonMarkup(markup, 'Mute microphone')).toContain('disabled');
    expect(buttonMarkup(markup, 'Turn camera off')).toContain('disabled');
    expect(buttonMarkup(markup, 'Cancel call')).not.toContain('disabled');
  });

  it('shows incoming accept/reject actions without attaching or rendering video media', () => {
    const markup = renderOverlay({ isIncomingCall: true, callLifecycleState: 'incoming', localCallStream: undefined, remoteCallStream: undefined });
    expect(buttonMarkup(markup, 'Accept call')).toBeTruthy();
    expect(buttonMarkup(markup, 'Decline call')).toBeTruthy();
    expect(markup).not.toContain('call-video-stage');
    expect(markup).not.toContain('aria-label="Local video preview"');
  });

  it('announces media failure without converting it into a connection error', () => {
    const markup = renderOverlay({ callError: 'Camera became unavailable. The call continues with video turned off.' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Camera became unavailable');
    expect(markup).not.toContain('network verification');
  });

  it('keeps the call contact tied to its room when the selected room changes', () => {
    const markup = renderOverlay({
      channelHash: 'room-2',
      activeCallRoomId: 'room-1',
      conversations: [
        { roomId: 'room-1', label: 'Private contact', remoteDisplayName: 'Bob' },
        { roomId: 'room-2', label: 'Private contact', remoteDisplayName: 'Cara' },
      ],
    });
    expect(markup).toContain('Bob');
    expect(markup).not.toContain('Cara');
  });
});
