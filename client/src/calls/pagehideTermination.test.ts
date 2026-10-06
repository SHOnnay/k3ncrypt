import { bindPageHideCallTermination } from './pagehideTermination';
import { CallMediaController } from '../../../service/src/calls/media';

describe('page-hide call termination', () => {
  it('attempts the normal terminal call action once when the page is leaving', async () => {
    const target = new EventTarget() as unknown as Window;
    const terminate = jest.fn(async () => undefined);
    const unbind = bindPageHideCallTermination(target, terminate);

    target.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    expect(terminate).toHaveBeenCalledTimes(1);
    unbind();
    target.dispatchEvent(new Event('pagehide'));
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('releases local capture through the normal terminal action on page hide', async () => {
    const target = new EventTarget() as unknown as Window;
    const track = { kind: 'audio', readyState: 'live', enabled: true, stop: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] } as unknown as MediaStream;
    const media = new CallMediaController({ getUserMedia: async () => stream });
    await media.request('microphone');
    const unbind = bindPageHideCallTermination(target, async () => media.release());

    target.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(media.activeStream).toBeUndefined();
    unbind();
  });
});
