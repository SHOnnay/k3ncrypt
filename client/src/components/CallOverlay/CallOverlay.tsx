/**
 * Call overlay component
 */

import React, { useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { useCallTimer } from '../../hooks/useCallTimer';
import { Button } from '../common/Button';
import { EndCallIcon, MicIcon, VolumeIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import './CallOverlay.css';

export const CallOverlay: React.FC = () => {
  const { callActive, callStatus, isIncomingCall, callLifecycleState, endCall, acceptCall, rejectCall, cancelCall } = useChat();
  const { duration, formatDuration, startTimer, stopTimer } = useCallTimer();

  useEffect(() => {
    if (callActive && callStatus === 'Connected') {
      startTimer();
    } else {
      stopTimer();
    }
  }, [callActive, callStatus, startTimer, stopTimer]);

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

  return (
    <div className="blur-overlay">
      <div className="call-info">
        <div className="call-avatar shimmer"><Avatar label="Private conversation" size="hero" /></div>
        <span className="call-kicker">Private audio call</span>
        <h3 id="call-status" className="call-status">
          {callStatus || 'Calling...'}
        </h3>
        <p id="call-duration" className="call-duration">
          {formatDuration(duration)}
        </p>
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
            <div className="call-control"><Button variant="secondary" circle disabled title="Mute is not available yet"><MicIcon size={20} /></Button><span>Mute</span><small>Later</small></div>
            <div className="call-control"><Button id="end-call-btn" variant="danger" circle size="large" onClick={handleEndCall} title={callLifecycleState === 'ringing' ? 'Cancel Call' : 'End Call'}><EndCallIcon size={27} /></Button><span>{callLifecycleState === 'ringing' ? 'Cancel' : 'End'}</span></div>
            <div className="call-control"><Button variant="secondary" circle disabled title="Speaker control is not available yet"><VolumeIcon size={20} /></Button><span>Speaker</span><small>Later</small></div>
          </div>
        )}
      </div>
    </div>
  );
};
