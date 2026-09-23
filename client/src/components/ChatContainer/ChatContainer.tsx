/**
 * Main chat container component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { MessagesArea } from './MessagesArea';
import { ChatFooter } from './ChatFooter';
import { CallOverlay } from '../CallOverlay/CallOverlay';
import './ChatContainer.css';
import { debugError } from '../../utils/debug';

interface ChatContainerProps {
  isHidden: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ isHidden }) => {
  const { startCall, startVideoCall, callLifecycleState } = useChat();
  const [, setIsStartingCall] = useState<boolean>(false);
  const isCallBusy = ['initiating', 'ringing', 'incoming', 'connecting', 'connected', 'ending'].includes(callLifecycleState);

  const handleStartCall = async () => {
    try {
      setIsStartingCall(true);
      await startCall();
    } catch (err) {
      debugError('Call start failed', err);
      alert((err as any).message || 'Failed to start call');
    } finally {
      setIsStartingCall(false);
    }
  };

  const handleStartVideoCall = async () => {
    try {
      setIsStartingCall(true);
      await startVideoCall();
    } catch (err) {
      debugError('Video call start failed', err);
      alert((err as any).message || 'Failed to start video call');
    } finally {
      setIsStartingCall(false);
    }
  };

  return (
    <>
      <div id="chat-container" className={`chat-container ${isHidden ? 'hidden' : ''}`}>
        <ChatHeader onStartCall={handleStartCall} onStartVideoCall={handleStartVideoCall} disableStartCall={isCallBusy} />
        <MessagesArea />
        <ChatFooter />
      </div>
      <CallOverlay />
    </>
  );
};
