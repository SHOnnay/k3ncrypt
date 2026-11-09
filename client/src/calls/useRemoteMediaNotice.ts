import { useEffect, useState } from 'react';
import { hasLiveAudio, hasLiveVideo, remoteAudioNotice, remoteCameraNotice, type RemoteMediaNotice } from './remoteMedia';

/**
 * N1 item 5: "Their microphone/camera disconnected" while a call is up, cleared again as soon as a live track returns.
 * Watches track mute/unmute/ended plus track add/remove, and re-checks once a second because a peer that drops a
 * device does not always fire an event.
 */
export function useRemoteMediaNotice(stream: MediaStream | undefined, active: boolean): RemoteMediaNotice | undefined {
  const [, rerender] = useState(0);
  const [seenAudio, setSeenAudio] = useState(false);
  const [seenVideo, setSeenVideo] = useState(false);
  useEffect(() => { setSeenAudio(false); setSeenVideo(false); }, [stream, active]);
  useEffect(() => {
    if (!stream || !active) return undefined;
    const watched = new Set<MediaStreamTrack>();
    const check = () => { if (hasLiveAudio(stream)) setSeenAudio(true); if (hasLiveVideo(stream)) setSeenVideo(true); rerender((value) => value + 1); };
    const watch = () => {
      for (const track of stream.getTracks()) {
        if (watched.has(track)) continue;
        watched.add(track);
        track.addEventListener('mute', check); track.addEventListener('unmute', check); track.addEventListener('ended', check);
      }
      check();
    };
    stream.addEventListener('addtrack', watch); stream.addEventListener('removetrack', check);
    watch();
    const timer = setInterval(check, 1_000);
    return () => {
      clearInterval(timer);
      stream.removeEventListener('addtrack', watch); stream.removeEventListener('removetrack', check);
      for (const track of watched) { track.removeEventListener('mute', check); track.removeEventListener('unmute', check); track.removeEventListener('ended', check); }
    };
  }, [stream, active]);
  if (!stream || !active) return undefined;
  return remoteAudioNotice(stream, seenAudio) ?? remoteCameraNotice(stream, seenVideo);
}
