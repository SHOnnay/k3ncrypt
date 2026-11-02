/**
 * Main chat container component
 */

import { contactsCopy } from '../../content/checkCopy';
import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { CheckContactProvider } from '../../context/CheckContactContext';
import { ChatHeader } from './ChatHeader';
import { MessagesArea } from './MessagesArea';
import { ChatFooter } from './ChatFooter';
import './ChatContainer.css';
import { debugError } from '../../utils/debug';
import { Button } from '../common/Button';
import { PlusIcon } from '../common/icons';
import { callStartFailureMessage, terminalCallStatusMessage } from '../../calls/callLaunchReadiness';
import { emptyStateOpenStatus } from '../../product/conversationOpenCopy';
import { contactDisplayName } from '../../content/copy';

interface ChatContainerProps {
  isHidden: boolean;
  onNewConversation: () => void;
  onVerifyContact: () => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ isHidden, onNewConversation, onVerifyContact }) => {
  const { startCall, startVideoCall, callLifecycleState, callError: remoteCallError, conversations, channelHash, protocolMode, pendingConversation, conversationOpenError } = useChat();
  const [isStartingCall, setIsStartingCall] = useState<boolean>(false);
  const [callError, setCallError] = useState('');
  const isCallBusy = ['initiating', 'ringing', 'incoming', 'connecting', 'connected', 'ending'].includes(callLifecycleState);
  const activeDescriptor = conversations.find((conversation) => conversation.roomId === channelHash);
  // Bug A: your own unaccepted invitation is not a chat. Its room stays connected underneath so
  // the first introduction can arrive; the chat area shows the empty state until someone accepts.
  const activeIsOwnInvitation = activeDescriptor?.relationship === 'invitation' && !activeDescriptor.remoteAddress;
  const hasActiveConversation = (Boolean(activeDescriptor) && !activeIsOwnInvitation)
    || (protocolMode === 'legacy' && Boolean(channelHash));
  const terminalCallMessage = terminalCallStatusMessage(callLifecycleState);

  if (!hasActiveConversation) {
    const hasContacts = conversations.some((conversation) => !(conversation.relationship === 'invitation' && !conversation.remoteAddress));
    const openStatus = emptyStateOpenStatus({ pending: pendingConversation, error: conversationOpenError }, (roomId) => {
      const item = conversations.find((conversation) => conversation.roomId === roomId);
      return contactDisplayName(item?.label, roomId, item?.remoteDisplayName, item?.localNickname);
    });
    return <main className={`chat-empty-page ${isHidden ? 'hidden' : ''}`} aria-label="Chats">
      <div className="chat-empty-card">
        <span className="chat-empty-mark" aria-hidden="true"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span>
        {/* Bug A: an own pending invitation is never presented here; it lives on the Invite screen. */}
        <h1>{hasContacts ? 'Choose a conversation' : contactsCopy.chatsEmptyTitle}</h1>
        <p>{hasContacts ? 'Select a saved contact from the list to open your conversation.' : contactsCopy.emptyHelp}</p>
        {openStatus && <p className={`chat-empty-open-status chat-empty-open-status--${openStatus.kind}`} role={openStatus.kind === 'failed' ? 'alert' : 'status'} aria-live="polite">{openStatus.text}</p>}
        {!hasContacts && <Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> {contactsCopy.inviteTitle}</Button>}
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
      setCallError(callStartFailureMessage(err, 'audio'));
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
      setCallError(callStartFailureMessage(err, 'video'));
    } finally {
      setIsStartingCall(false);
    }
  };

  return (
    <>
      <CheckContactProvider value={onVerifyContact}>
      <div id="chat-container" className={`chat-container ${isHidden ? 'hidden' : ''}`}>
        <ChatHeader onStartCall={handleStartCall} onStartVideoCall={handleStartVideoCall} disableStartCall={isCallBusy || isStartingCall} />
        {(callError || remoteCallError) && <div className="chat-call-error" role="alert">{remoteCallError || callError}</div>}
        {!callError && !remoteCallError && terminalCallMessage && <div className="chat-call-status" role="status">{terminalCallMessage}</div>}
        <MessagesArea />
        <ChatFooter onVerifyContact={onVerifyContact} />
      </div>
      </CheckContactProvider>
    </>
  );
};
