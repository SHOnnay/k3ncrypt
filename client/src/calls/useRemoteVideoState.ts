import { useEffect, useState, type RefObject } from 'react';
import { remoteVideoPlaceholder, type VideoPlaceholder } from './callVideoUiState';

/** No new remote frame for this long, after video has played, means the other camera is off. */
export const REMOTE_FRAME_STALL_MS = 1_500;

/**
 * Part A2 bug 2: a camera turned off on the other side stops the frames but leaves the remote track live,
 * so the <video> would freeze on its last frame. Watches frames (and mute/unmute where the browser fires it).
 */
export function useRemoteVideoState(stream: MediaStream | undefined, video: RefObject<HTMLVideoElement>): VideoPlaceholder | undefined {
  const [, rerender] = useState(0);
  const [seenVideo, setSeenVideo] = useState(false);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setSeenVideo(false); setStalled(false);
    if (!stream) return undefined;
    let lastFrame = 0; let frameRequest: number | undefined; let disposed = false;
    const element = video.current as (HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number; cancelVideoFrameCallback?: (handle: number) => void }) | null;
    const onFrame = () => {
      if (disposed) return;
      lastFrame = performance.now(); setSeenVideo(true); setStalled(false);
      frameRequest = element?.requestVideoFrameCallback?.(onFrame);
    };
    frameRequest = element?.requestVideoFrameCallback?.(onFrame);
    const timer = setInterval(() => { if (lastFrame && performance.now() - lastFrame > REMOTE_FRAME_STALL_MS) setStalled(true); }, 500);
    const update = () => rerender((value) => value + 1);
    const watched = new Set<MediaStreamTrack>();
    const watch = () => {
      for (const track of stream.getVideoTracks()) {
        if (watched.has(track)) continue;
        watched.add(track);
        track.addEventListener('mute', update); track.addEventListener('unmute', update); track.addEventListener('ended', update);
      }
      update();
    };
    stream.addEventListener('addtrack', watch); stream.addEventListener('removetrack', update);
    watch();
    return () => {
      disposed = true; clearInterval(timer);
      if (frameRequest !== undefined) element?.cancelVideoFrameCallback?.(frameRequest);
      stream.removeEventListener('addtrack', watch); stream.removeEventListener('removetrack', update);
      for (const track of watched) { track.removeEventListener('mute', update); track.removeEventListener('unmute', update); track.removeEventListener('ended', update); }
    };
  }, [stream, video]);
  return remoteVideoPlaceholder(stream, seenVideo, stalled);
}
