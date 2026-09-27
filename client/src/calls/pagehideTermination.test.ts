import { bindPageHideCallTermination } from './pagehideTermination';

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
});
