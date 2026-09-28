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
import { Button } from '../common/Button';
import { PlusIcon } from '../common/icons';
import { copy } from '../../content/copy';

interface ChatContainerProps {
  isHidden: boolean;
  onNewConversation: () => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ isHidden, onNewConversation }) => {
  const { startCall, startVideoCall, callLifecycleState, conversations, channelHash, protocolMode } = useChat();
  const [isStartingCall, setIsStartingCall] = useState<boolean>(false);
  const [callError, setCallError] = useState('');
  const isCallBusy = ['initiating', 'ringing', 'incoming', 'connecting', 'connected', 'ending'].includes(callLifecycleState);
  const hasActiveConversation = conversations.some((conversation) => conversation.roomId === channelHash)
    || (protocolMode === 'legacy' && Boolean(channelHash));

  if (!hasActiveConversation) {
    const hasContacts = conversations.length > 0;
    return <main className={`chat-empty-page ${isHidden ? 'hidden' : ''}`} aria-label="Chats">
      <div className="chat-empty-card">
        <span className="chat-empty-mark" aria-hidden="true"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span>
        <h1>{hasContacts ? 'Choose a conversation' : copy.contactsEmpty.title}</h1>
        <p>{hasContacts ? 'Select a saved contact from the list to open your conversation.' : copy.contactsEmpty.description}</p>
        {!hasContacts && <Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Create or join an invitation</Button>}
      </div>
    </main>;
  }

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
