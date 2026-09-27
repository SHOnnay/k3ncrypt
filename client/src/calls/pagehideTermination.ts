/** Best-effort terminal call signal for a normally closing/navigating tab. */
export const bindPageHideCallTermination = (
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  terminate: () => Promise<unknown>,
): (() => void) => {
  const onPageHide = (): void => { void terminate().catch(() => undefined); };
  target.addEventListener('pagehide', onPageHide);
  return () => target.removeEventListener('pagehide', onPageHide);
};
