import { hasLiveAudio, remoteAudioNotice, remoteCameraNotice, remoteMediaNoticeCopy } from './remoteMedia';

const track = (readyState: string, muted = false) => ({ readyState, muted, enabled: true });
const stream = (audio: ReturnType<typeof track>[], video: ReturnType<typeof track>[] = []) => ({ getAudioTracks: () => audio, getVideoTracks: () => video });

describe('N1 remote microphone/camera notices [unit test]', () => {
  it('shows nothing while the call is still joining (audio not yet seen)', () => expect(remoteAudioNotice(stream([]), false)).toBeUndefined());
  it('shows nothing while remote audio is live', () => expect(remoteAudioNotice(stream([track('live')]), true)).toBeUndefined());
  it('says the microphone disconnected when audio was live and the track ended or the browser muted it', () => {
    expect(remoteAudioNotice(stream([track('ended')]), true)).toBe('remote-mic-lost');
    expect(remoteAudioNotice(stream([track('live', true)]), true)).toBe('remote-mic-lost');
    expect(remoteAudioNotice(stream([]), true)).toBe('remote-mic-lost');
    expect(remoteMediaNoticeCopy['remote-mic-lost']).toBe('Their microphone disconnected');
  });
  it('recovers on its own when a live audio track returns', () => {
    const lost = stream([track('ended')]); expect(remoteAudioNotice(lost, true)).toBe('remote-mic-lost');
    const back = stream([track('ended'), track('live')]); expect(remoteAudioNotice(back, true)).toBeUndefined();
    expect(hasLiveAudio(back)).toBe(true);
  });
  it('reports a dropped camera only when every video track ended after video was seen', () => {
    expect(remoteCameraNotice(stream([], [track('ended')]), true)).toBe('remote-camera-lost');
    expect(remoteCameraNotice(stream([], [track('ended')]), false)).toBeUndefined();
    expect(remoteCameraNotice(stream([], [track('live', true)]), true)).toBeUndefined();
    expect(remoteCameraNotice(stream([], [track('ended'), track('live')]), true)).toBeUndefined();
    expect(remoteMediaNoticeCopy['remote-camera-lost']).toBe('Their camera disconnected');
  });
});
