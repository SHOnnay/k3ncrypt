export type VideoPlaceholder = 'camera-off' | 'camera-starting' | 'remote-waiting' | 'remote-camera-off';

export const hasLiveEnabledVideoTrack = (stream?: MediaStream): boolean => Boolean(
  stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled),
);

export const localVideoPlaceholder = (cameraEnabled: boolean, stream?: MediaStream): VideoPlaceholder | undefined => {
  if (cameraEnabled && hasLiveEnabledVideoTrack(stream)) return undefined;
  return cameraEnabled ? 'camera-starting' : 'camera-off';
};

/**
 * The sender turns its camera off by sending no video: the remote track stays live, and frames stop
 * (`stalled`); some browsers also mark the track muted. Once remote video has played (`seenVideo`),
 * either means the camera is off.
 */
export const remoteVideoPlaceholder = (stream?: MediaStream, seenVideo = false, stalled = false): VideoPlaceholder | undefined => {
  if (!stalled && stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled && !track.muted)) return undefined;
  return seenVideo ? 'remote-camera-off' : 'remote-waiting';
};

export const videoPlaceholderCopy: Record<VideoPlaceholder, string> = {
  'camera-off': 'Camera off',
  'camera-starting': 'Camera starting…',
  'remote-waiting': 'Waiting for remote video',
  'remote-camera-off': 'Camera off',
};
