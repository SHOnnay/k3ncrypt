/**
 * Call overlay component
 */

import React, { useEffect, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { useCallTimer } from '../../hooks/useCallTimer';
import { Button } from '../common/Button';
import { EndCallIcon, MicIcon, VideoIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import { startRingtone, stopRingtone } from '../../utils/ringtone';
import { attachMediaStream } from './mediaStream';
import './CallOverlay.css';

export const CallOverlay: React.FC = () => {
  const { callActive, callStatus, isIncomingCall, callLifecycleState, callMediaMode, localCallStream, remoteCallStream, microphoneMuted, cameraEnabled, callError, endCall, acceptCall, rejectCall, cancelCall, setMicrophoneMuted, setCameraEnabled, privacyPreferences } = useChat();
  const { duration, formatDuration, startTimer, stopTimer } = useCallTimer();
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    attachMediaStream(localVideo.current, localCallStream);
    return () => attachMediaStream(localVideo.current, undefined);
  }, [localCallStream]);

  useEffect(() => {
    attachMediaStream(remoteVideo.current, remoteCallStream);
    return () => attachMediaStream(remoteVideo.current, undefined);
  }, [remoteCallStream]);

  useEffect(() => {
    if (callActive && callStatus === 'Connected') {
      startTimer();
    } else {
      stopTimer();
    }
  }, [callActive, callStatus, startTimer, stopTimer]);

  useEffect(() => {
    if (callActive && isIncomingCall && callLifecycleState === 'incoming' && privacyPreferences.ringtoneEnabled) startRingtone();
    else stopRingtone();
    return stopRingtone;
  }, [callActive, callLifecycleState, isIncomingCall, privacyPreferences.ringtoneEnabled]);

  if (!callActive) return null;

  const handleEndCall = async () => {
    if (callLifecycleState === 'ringing') {
      await cancelCall();
      return;
    }
    await endCall();
  };

  const handleAcceptCall = async () => {
    await acceptCall();
  };

  const handleRejectCall = async () => {
    await rejectCall();
  };

  const isVideo = callMediaMode === 'video';

  return (
    <div className="blur-overlay">
      <div className={`call-info ${isVideo ? 'call-info--video' : ''}`}>
        {isVideo && !isIncomingCall && <div className="call-video-stage">
          {remoteCallStream ? <video ref={remoteVideo} className="call-video-remote" autoPlay playsInline aria-label="Remote video" /> : <div className="call-video-placeholder">Waiting for remote video</div>}
          <div className="call-video-preview">
            {localCallStream ? <video ref={localVideo} autoPlay muted playsInline aria-label="Local video preview" /> : <span>Camera starting…</span>}
            <span className="call-video-indicator">{cameraEnabled ? 'Camera on' : 'Camera off'}</span>
          </div>
        </div>}
        {(!isVideo || isIncomingCall) && <div className="call-avatar shimmer"><Avatar label="Private conversation" size="hero" /></div>}
        <span className="call-kicker">Private {isVideo ? 'video' : 'audio'} call</span>
        <h3 id="call-status" className="call-status">
          {callStatus || 'Calling...'}
        </h3>
        <p id="call-duration" className="call-duration">
          {formatDuration(duration)}
        </p>
        {callError && <p className="call-error" role="alert">{callError}</p>}
        {isIncomingCall ? (
          <div className="incoming-call-actions">
            <Button variant="secondary" size="medium" onClick={handleAcceptCall} title="Accept Call">
              Accept
            </Button>
            <Button variant="danger" size="medium" onClick={handleRejectCall} title="Decline Call">
              Decline
            </Button>
          </div>
        ) : (
          <div className="call-controls">
            <div className="call-control"><Button variant="secondary" circle onClick={() => setMicrophoneMuted(!microphoneMuted)} title={microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}><MicIcon size={20} /></Button><span>{microphoneMuted ? 'Unmute' : 'Mute'}</span></div>
            <div className="call-control"><Button id="end-call-btn" variant="danger" circle size="large" onClick={handleEndCall} title={callLifecycleState === 'ringing' ? 'Cancel Call' : 'End Call'}><EndCallIcon size={27} /></Button><span>{callLifecycleState === 'ringing' ? 'Cancel' : 'End'}</span></div>
            {isVideo && <div className="call-control"><Button variant="secondary" circle onClick={() => setCameraEnabled(!cameraEnabled)} title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}><VideoIcon size={20} /></Button><span>{cameraEnabled ? 'Camera off' : 'Camera on'}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
};
