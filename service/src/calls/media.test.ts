import { BrowserCallMediaConnection, CallMediaController, type MediaCapture } from './media';

const makeTrack = (kind: 'audio' | 'video') => {
  const listeners = new Set<() => void>();
  const value = {
    id: `${kind}-${Math.random()}`,
    kind,
    enabled: true,
    readyState: 'live',
    stop: jest.fn(() => { value.readyState = 'ended'; }),
    addEventListener: jest.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: jest.fn((_event: string, listener: () => void) => listeners.delete(listener)),
    applyConstraints: jest.fn(async () => undefined),
    getSettings: jest.fn(() => ({ facingMode: 'user' })),
    end: () => { value.readyState = 'ended'; [...listeners].forEach((listener) => listener()); },
  };
  return value as unknown as MediaStreamTrack & { end: () => void };
};

const makeStream = (...tracks: MediaStreamTrack[]) => {
  const current = [...tracks];
  return {
    getTracks: () => [...current],
    getAudioTracks: () => current.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => current.filter((track) => track.kind === 'video'),
    addTrack: (track: MediaStreamTrack) => { if (!current.includes(track)) current.push(track); },
    removeTrack: (track: MediaStreamTrack) => { const index = current.indexOf(track); if (index >= 0) current.splice(index, 1); },
  } as unknown as MediaStream;
};

describe('call media transport boundary', () => {
  it('passes relay-only policy to the actual peer factory', () => {
    const factory = jest.fn(() => ({} as RTCPeerConnection));
    new BrowserCallMediaConnection([], factory, 'relay');
    expect(factory).toHaveBeenCalledWith({ iceServers: [], iceTransportPolicy: 'relay' });
  });

  it('requests audio only for microphone intent and releases all tracks', async () => {
    const audio = makeTrack('audio');
    const captured = makeStream(audio);
    const capture: MediaCapture = { getUserMedia: jest.fn(async () => captured) };
    const controller = new CallMediaController(capture);
    await controller.request('microphone');
    expect(capture.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    controller.release();
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it('reports permission denial without exposing browser error details', async () => {
    const controller = new CallMediaController({ getUserMedia: async () => { throw Object.assign(new Error('camera serial and browser detail'), { name: 'NotAllowedError' }); } });
    await expect(controller.request('camera')).rejects.toThrow('permission was denied or dismissed');
    await expect(controller.request('microphone')).rejects.toThrow('Microphone permission was denied or dismissed');
  });

  it('reports unavailable devices truthfully for microphone and video intent', async () => {
    const controller = new CallMediaController({ getUserMedia: async () => { throw Object.assign(new Error('private device detail'), { name: 'NotFoundError' }); } });
    await expect(controller.request('camera')).rejects.toThrow('A camera or microphone is unavailable');
    await expect(controller.request('microphone')).rejects.toThrow('A microphone is unavailable');
  });

  it('repeated mute and unmute only toggles live local audio transmission', async () => {
    const audio = makeTrack('audio');
    const controller = new CallMediaController({ getUserMedia: async () => makeStream(audio) });
    await controller.request('microphone');
    controller.setMicrophoneEnabled(false);
    controller.setMicrophoneEnabled(false);
    expect(audio.enabled).toBe(false);
    controller.setMicrophoneEnabled(true);
    controller.setMicrophoneEnabled(true);
    expect(audio.enabled).toBe(true);
    controller.release();
    controller.setMicrophoneEnabled(true);
    expect(audio.enabled).toBe(true);
  });

  it('releases the camera when switched off and reacquires one track when switched on', async () => {
    const audio = makeTrack('audio');
    const firstCamera = makeTrack('video');
    const secondCamera = makeTrack('video');
    const capture = { getUserMedia: jest.fn()
      .mockResolvedValueOnce(makeStream(audio, firstCamera))
      .mockResolvedValueOnce(makeStream(secondCamera)) };
    const controller = new CallMediaController(capture);
    const local = await controller.request('camera');
    await controller.setCameraEnabled(false);
    expect(firstCamera.stop).toHaveBeenCalledTimes(1);
    expect(local.getVideoTracks()).toHaveLength(0);
    await controller.setCameraEnabled(true);
    expect(capture.getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: true });
    expect(local.getVideoTracks()).toEqual([secondCamera]);
    expect(local.getAudioTracks()).toEqual([audio]);
    controller.release();
    expect(secondCamera.stop).toHaveBeenCalledTimes(1);
  });

  it('reports local camera track loss and safely switches the active device where supported', async () => {
    const audio = makeTrack('audio');
    const camera = makeTrack('video');
    const controller = new CallMediaController({ getUserMedia: async () => makeStream(audio, camera) });
    await controller.request('camera');
    const ended = jest.fn();
    controller.onTrackEnded(ended);
    expect(await controller.switchCamera()).toBe(true);
    expect(camera.applyConstraints).toHaveBeenCalledWith({ facingMode: 'environment' });
    camera.end();
    expect(ended).toHaveBeenCalledWith('video');
    expect(controller.activeStream?.getVideoTracks()).toHaveLength(0);
    controller.release();
  });

  it('runs fifty software capture and teardown lifecycles without retaining tracks', async () => {
    const tracks: MediaStreamTrack[] = [];
    const controller = new CallMediaController({ getUserMedia: async () => {
      const audio = makeTrack('audio');
      tracks.push(audio);
      return makeStream(audio);
    } });
    for (let index = 0; index < 50; index += 1) {
      await controller.request('microphone');
      controller.release();
    }
    expect(tracks).toHaveLength(50);
    expect(tracks.every((track) => (track.stop as jest.Mock).mock.calls.length === 1)).toBe(true);
    expect(controller.activeStream).toBeUndefined();
  });

  it('replaces the existing video sender without creating another PeerConnection track', async () => {
    const audio = makeTrack('audio');
    const video = makeTrack('video');
    const audioSender = { replaceTrack: jest.fn(async () => undefined) } as unknown as RTCRtpSender;
    const videoSender = { replaceTrack: jest.fn(async () => undefined) } as unknown as RTCRtpSender;
    const fake = {
      connectionState: 'new', close: jest.fn(), addTrack: jest.fn((track: MediaStreamTrack) => track.kind === 'video' ? videoSender : audioSender),
    } as unknown as RTCPeerConnection;
    const connection = new BrowserCallMediaConnection([], () => fake);
    connection.addStream(makeStream(audio, video));
    await connection.replaceLocalTrack('video', null);
    await connection.replaceLocalTrack('video', video);
    expect(fake.addTrack).toHaveBeenCalledTimes(2);
    expect(videoSender.replaceTrack).toHaveBeenNthCalledWith(1, null);
    expect(videoSender.replaceTrack).toHaveBeenNthCalledWith(2, video);
    await connection.close();
  });

  it('deduplicates remote tracks, removes ended video, and ignores callbacks after close', async () => {
    const originalMediaStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
    class FakeRemoteStream {
      private readonly tracks: MediaStreamTrack[] = [];
      getTracks(): MediaStreamTrack[] { return [...this.tracks]; }
      getAudioTracks(): MediaStreamTrack[] { return this.tracks.filter((track) => track.kind === 'audio'); }
      getVideoTracks(): MediaStreamTrack[] { return this.tracks.filter((track) => track.kind === 'video'); }
      addTrack(track: MediaStreamTrack): void { if (!this.tracks.some((item) => item.id === track.id)) this.tracks.push(track); }
      removeTrack(track: MediaStreamTrack): void { const index = this.tracks.indexOf(track); if (index >= 0) this.tracks.splice(index, 1); }
    }
    Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: FakeRemoteStream });
    try {
      let ontrack: ((event: RTCTrackEvent) => void) | null = null;
      const fake = {
        connectionState: 'new', close: jest.fn(),
        set ontrack(value: ((event: RTCTrackEvent) => void) | null) { ontrack = value; },
      } as unknown as RTCPeerConnection;
      const connection = new BrowserCallMediaConnection([], () => fake);
      const lengths: number[] = [];
      connection.onRemoteStream((remote) => lengths.push(remote.getVideoTracks().length));
      const camera = makeTrack('video');
      const event = { track: camera, streams: [makeStream(camera)] } as unknown as RTCTrackEvent;
      ontrack?.(event);
      ontrack?.(event);
      expect(lengths.at(-1)).toBe(1);
      camera.end();
      expect(lengths.at(-1)).toBe(0);
      const lateHandler = ontrack;
      await connection.close();
      const lateTrack = makeTrack('video');
      lateHandler?.({ track: lateTrack, streams: [makeStream(lateTrack)] } as unknown as RTCTrackEvent);
      expect(lengths.at(-1)).toBe(0);
      expect(lengths).not.toContain(2);
    } finally {
      if (originalMediaStream) Object.defineProperty(globalThis, 'MediaStream', originalMediaStream);
      else Reflect.deleteProperty(globalThis, 'MediaStream');
    }
  });

  it('maps peer disconnect to reconnecting and closes resources', async () => {
    const listeners: (() => void)[] = [];
    const fake = { connectionState: 'new', close: jest.fn(), setLocalDescription: jest.fn(), setRemoteDescription: jest.fn(), createOffer: jest.fn(async () => ({})), createAnswer: jest.fn(async () => ({})), addIceCandidate: jest.fn(), addTrack: jest.fn(), set onconnectionstatechange(value: () => void) { listeners.push(value); } } as unknown as RTCPeerConnection;
    const connection = new BrowserCallMediaConnection([], () => fake);
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    (fake as any).connectionState = 'disconnected';
    listeners[0]();
    expect(states).toContain('reconnecting');
    await connection.close();
    await connection.close();
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(states).toContain('closed');
  });
});
