/**
 * Main chat container component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { MessagesArea } from './MessagesArea';
import { ChatFooter } from './ChatFooter';
import './ChatContainer.css';
import { debugError } from '../../utils/debug';

interface ChatContainerProps {
  isHidden: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ isHidden }) => {
  const { startCall, startVideoCall, callLifecycleState } = useChat();
  const [isStartingCall, setIsStartingCall] = useState<boolean>(false);
  const [callError, setCallError] = useState('');
  const isCallBusy = ['initiating', 'ringing', 'incoming', 'connecting', 'connected', 'ending'].includes(callLifecycleState);

  const handleStartCall = async () => {
    try {
      setCallError('');
      setIsStartingCall(true);
      await startCall();
    } catch (err) {
      debugError('Call start failed', err);
      setCallError('Could not start the call. Check microphone access and your connection, then retry.');
    } finally {
      setIsStartingCall(false);
    }
  };

  const handleStartVideoCall = async () => {
    try {
      setCallError('');
      setIsStartingCall(true);
      await startVideoCall();
    } catch (err) {
      debugError('Video call start failed', err);
      setCallError('Could not start the video call. Check camera and microphone access, then retry.');
    } finally {
      setIsStartingCall(false);
    }
  };

  return (
    <>
      <div id="chat-container" className={`chat-container ${isHidden ? 'hidden' : ''}`}>
        <ChatHeader onStartCall={handleStartCall} onStartVideoCall={handleStartVideoCall} disableStartCall={isCallBusy || isStartingCall} />
        {callError && <div className="chat-call-error" role="alert">{callError}</div>}
        <MessagesArea />
        <ChatFooter />
      </div>
    </>
  );
};
