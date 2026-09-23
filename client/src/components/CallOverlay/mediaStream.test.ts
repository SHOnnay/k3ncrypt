import { attachMediaStream } from './mediaStream';

describe('attachMediaStream', () => {
  it('attaches a local or remote stream to a media element', () => {
    const stream = { id: 'stream-1' } as MediaStream;
    const element = { srcObject: null } as unknown as HTMLMediaElement;

    attachMediaStream(element, stream);

    expect(element.srcObject).toBe(stream);
  });

  it('clears the media element when a call stream is unavailable or ended', () => {
    const element = { srcObject: { id: 'old' } } as unknown as HTMLMediaElement;

    attachMediaStream(element, undefined);

    expect(element.srcObject).toBeNull();
  });
});
