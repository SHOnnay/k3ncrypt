/**
 * N1 item 5: tell "their device lost the microphone/camera" apart from "still joining".
 * A track that played and then ended, or is muted by the browser, means the device dropped. A new live track
 * replaces the old one and the notice clears by itself, because this is recomputed from the stream each time.
 */
export type RemoteMediaNotice = 'remote-mic-lost' | 'remote-camera-lost';

export const remoteMediaNoticeCopy: Record<RemoteMediaNotice, string> = {
  'remote-mic-lost': 'Their microphone disconnected',
  'remote-camera-lost': 'Their camera disconnected',
};

interface TrackLike { readyState: string; muted: boolean; enabled: boolean }
interface StreamLike { getAudioTracks(): TrackLike[]; getVideoTracks(): TrackLike[] }

const live = (track: TrackLike): boolean => track.readyState === 'live' && !track.muted;

/** `seenAudio`: remote audio has been live at some point in this call. Before that, nothing is "lost" yet. */
export const remoteAudioNotice = (stream: StreamLike | undefined, seenAudio: boolean): RemoteMediaNotice | undefined => {
  if (!stream || !seenAudio) return undefined;
  return stream.getAudioTracks().some(live) ? undefined : 'remote-mic-lost';
};

/** Only an ended track counts as a dropped camera; a deliberately switched-off camera keeps its own "Camera off" state. */
export const remoteCameraNotice = (stream: StreamLike | undefined, seenVideo: boolean): RemoteMediaNotice | undefined => {
  if (!stream || !seenVideo) return undefined;
  const tracks = stream.getVideoTracks();
  return tracks.length > 0 && tracks.every((track) => track.readyState === 'ended') ? 'remote-camera-lost' : undefined;
};

export const hasLiveAudio = (stream: StreamLike | undefined): boolean => Boolean(stream?.getAudioTracks().some(live));
export const hasLiveVideo = (stream: StreamLike | undefined): boolean => Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));
