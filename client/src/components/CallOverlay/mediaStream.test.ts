import { attachMediaStream } from './mediaStream';

describe('attachMediaStream', () => {
  it('attaches a local or remote stream to a media element', () => {
    const stream = { id: 'stream-1' } as MediaStream;
    const element = { srcObject: null } as unknown as HTMLMediaElement;

    attachMediaStream(element, stream);

    expect(element.srcObject).toBe(stream);
  });

  it('attaches the remote stream to the voice-call audio sink', () => {
    const stream = { id: 'remote-audio-stream' } as MediaStream;
    const audio = { srcObject: null } as unknown as HTMLAudioElement;

    attachMediaStream(audio, stream);

    expect(audio.srcObject).toBe(stream);
  });

  it('clears the media element when a call stream is unavailable or ended', () => {
    const element = { srcObject: { id: 'old' } } as unknown as HTMLMediaElement;

    attachMediaStream(element, undefined);

    expect(element.srcObject).toBeNull();
  });
});
