/**
 * Chat header component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { CopyIcon, ShareIcon, PhoneIcon, TrashIcon, VideoIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import { StatusPill } from '../common/StatusPill';
import './ChatHeader.css';
import { debugError } from '../../utils/debug';

interface ChatHeaderProps {
  onStartCall: () => void;
  onStartVideoCall: () => void;
  disableStartCall?: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onStartCall, onStartVideoCall, disableStartCall = false }) => {
  const { isConnected, channelHash, deleteChannel, protocolMode, sessionHealth, conversations, contactIdentity } = useChat();
  const [hashCopied, setHashCopied] = useState(false);
  const activeConversation = conversations.find((conversation) => conversation.roomId === channelHash)
    ?? (protocolMode === 'legacy' && channelHash ? { roomId: channelHash, label: 'Private conversation' } : undefined);
  const contactLabel = activeConversation?.label ?? 'Conversation';

  const handleCopyHash = () => {
    navigator.clipboard.writeText(window.location.href);
    setHashCopied(true);
    setTimeout(() => setHashCopied(false), 2000);
  };

  const handleShare = () => {
    if ('share' in navigator) {
      navigator
        .share({
          title: 'K3ncrypt invitation',
          text: 'Join my private conversation',
          url: window.location.href,
        })
        .catch(() => {
          /* user cancelled */
        });
    }
  };

const handleDelete = async () => {
  if (!window.confirm('Are you sure you want to delete this secure channel? This cannot be undone.')) return;

  try {
    await deleteChannel();
    window.location.hash = ''; // Clear URL hash
  } catch (err) {
    debugError('Conversation deletion failed', err);
    alert('Could not delete this conversation. Please retry.');
  }
};

  return (
    <header className={`chat-header glass ${isConnected ? 'active' : ''}`}>
      <Avatar label={contactLabel} size="medium" status={isConnected ? 'online' : 'offline'} />
      <div className="header-info">
        <div className="title-row">
          <h2 className="channel-title">{contactLabel}</h2>
          {activeConversation && <StatusPill tone="neutral">{protocolMode === 'modern' ? 'Encrypted chat' : 'Private chat'}</StatusPill>}
          {activeConversation && protocolMode === 'modern' && contactIdentity && <StatusPill tone={contactIdentity.verification === 'verified' && contactIdentity.changeStatus === 'unchanged' ? 'positive' : 'quiet'}>{contactIdentity.verification === 'verified' && contactIdentity.changeStatus === 'unchanged' ? 'Verified contact' : 'Verify contact'}</StatusPill>}
        </div>
        {activeConversation && protocolMode === 'legacy' && (
          <div className="hash-badge-container">
            <StatusPill tone="quiet">Private conversation</StatusPill>
            <Button
              className="btn--icon btn--tiny"
              variant="secondary"
              onClick={handleCopyHash}
              title="Copy conversation link"
              aria-label="Copy conversation link"
            >
              <CopyIcon size={14} />
            </Button>
            {hashCopied && <span className="copy-feedback-small">Copied!</span>}
          </div>
        )}
        <p id="participant-info" className="participant-info">
          {activeConversation && (sessionHealth === 'unhealthy' ? 'Review the security update for this conversation before continuing.' : sessionHealth === 'renewal-pending' ? 'Waiting for your contact to review the connection update.' : isConnected ? protocolMode === 'modern' ? 'Messages in this conversation are encrypted.' : 'Conversation connected' : 'Waiting for your contact to connect')}
        </p>
      </div>
      <div className="header-actions">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Button
            className="btn--icon chat-header__share-action"
            variant="secondary"
            onClick={handleShare}
            title="Share Link"
          >
            <ShareIcon size={20} />
          </Button>
        )}
        <Button
          className="btn--icon"
          variant="secondary"
          onClick={onStartCall}
          title="Start Audio Call"
          disabled={disableStartCall || !isConnected || sessionHealth !== 'healthy'}
        >
          <PhoneIcon size={20} />
        </Button>
        <Button
          className="btn--icon"
          variant="secondary"
          onClick={onStartVideoCall}
          title="Start Video Call"
          disabled={disableStartCall || !isConnected || protocolMode === 'modern'}
        >
          <VideoIcon size={20} />
        </Button>
        <Button
          className="btn--icon"
          variant="danger"
          onClick={handleDelete}
          title="Delete Chat"
          disabled={!activeConversation}
        >
          <TrashIcon size={20} />
        </Button>
      </div>
    </header>
  );
};
