import { hasLiveEnabledVideoTrack, localVideoPlaceholder, remoteVideoPlaceholder, videoPlaceholderCopy } from './callVideoUiState';

describe('video call view state', () => {
  const videoTrack = (overrides: Partial<MediaStreamTrack> = {}) => ({
    kind: 'video',
    readyState: 'live',
    enabled: true,
    ...overrides,
  } as MediaStreamTrack);
  const stream = (...tracks: MediaStreamTrack[]): MediaStream => ({
    getVideoTracks: () => tracks,
  } as unknown as MediaStream);

  it('renders local video only when the selected camera has a live enabled track', () => {
    expect(localVideoPlaceholder(true, stream(videoTrack()))).toBeUndefined();
    expect(localVideoPlaceholder(false, stream(videoTrack()))).toBe('camera-off');
    expect(localVideoPlaceholder(true, stream(videoTrack({ readyState: 'ended' })))).toBe('camera-starting');
    expect(localVideoPlaceholder(true, stream(videoTrack({ enabled: false })))).toBe('camera-starting');
    expect(localVideoPlaceholder(true, undefined)).toBe('camera-starting');
  });

  // Part A2 bug 2: a sender that turns the camera off stops sending frames; the remote track goes muted.
  it('shows Camera off when remote video that has played is muted, and waits before the first frame', () => {
    expect(remoteVideoPlaceholder(stream(videoTrack({ muted: true })), true)).toBe('remote-camera-off');
    expect(remoteVideoPlaceholder(stream(videoTrack({ muted: true })), false)).toBe('remote-waiting');
    expect(remoteVideoPlaceholder(stream(), true)).toBe('remote-camera-off');
    expect(remoteVideoPlaceholder(stream(videoTrack({ muted: false })), true)).toBeUndefined();
    expect(remoteVideoPlaceholder(stream(videoTrack({ muted: false })), true, true)).toBe('remote-camera-off');
    expect(videoPlaceholderCopy['remote-camera-off']).toBe('Camera off');
  });

  it('shows a neutral remote-video wait state when no live enabled remote video exists', () => {
    expect(remoteVideoPlaceholder(stream(videoTrack()))).toBeUndefined();
    expect(remoteVideoPlaceholder(undefined)).toBe('remote-waiting');
    expect(remoteVideoPlaceholder(stream(videoTrack({ enabled: false })))).toBe('remote-waiting');
    expect(remoteVideoPlaceholder(stream(videoTrack({ readyState: 'ended' })))).toBe('remote-waiting');
  });

  it('uses visible text for each camera state', () => {
    expect(videoPlaceholderCopy['camera-off']).toBe('Camera off');
    expect(videoPlaceholderCopy['camera-starting']).toMatch(/starting/);
    expect(videoPlaceholderCopy['remote-waiting']).toMatch(/Waiting/);
    expect(hasLiveEnabledVideoTrack(undefined)).toBe(false);
  });
});
