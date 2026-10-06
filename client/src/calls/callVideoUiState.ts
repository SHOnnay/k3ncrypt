export type VideoPlaceholder = 'camera-off' | 'camera-starting' | 'remote-waiting';

export const hasLiveEnabledVideoTrack = (stream?: MediaStream): boolean => Boolean(
  stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled),
);

export const localVideoPlaceholder = (cameraEnabled: boolean, stream?: MediaStream): VideoPlaceholder | undefined => {
  if (cameraEnabled && hasLiveEnabledVideoTrack(stream)) return undefined;
  return cameraEnabled ? 'camera-starting' : 'camera-off';
};

export const remoteVideoPlaceholder = (stream?: MediaStream): VideoPlaceholder | undefined =>
  hasLiveEnabledVideoTrack(stream) ? undefined : 'remote-waiting';

export const videoPlaceholderCopy: Record<VideoPlaceholder, string> = {
  'camera-off': 'Camera off',
  'camera-starting': 'Camera starting…',
  'remote-waiting': 'Waiting for remote video',
};
