/**
 * Chat header component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { CopyIcon, ShareIcon, PhoneIcon, TrashIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import { StatusPill } from '../common/StatusPill';
import './ChatHeader.css';
import { debugError } from '../../utils/debug';

interface ChatHeaderProps {
  onStartCall: () => void;
  disableStartCall?: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onStartCall, disableStartCall = false }) => {
  const { isConnected, channelHash, deleteChannel } = useChat();
  const [hashCopied, setHashCopied] = useState(false);

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
    alert((err as any).message || 'Failed to delete channel');
  }
};

  return (
    <header className={`chat-header glass ${isConnected ? 'active' : ''}`}>
      <Avatar label="Private conversation" size="medium" status={isConnected ? 'online' : 'offline'} />
      <div className="header-info">
        <div className="title-row">
          <h2 className="channel-title">Private conversation</h2>
          <StatusPill tone="positive">Private</StatusPill>
        </div>
        {channelHash && (
          <div className="hash-badge-container">
            <span className="hash-text">{channelHash}</span>
            <Button
              className="btn--icon btn--tiny"
              variant="secondary"
              onClick={handleCopyHash}
              title="Copy Link"
            >
              <CopyIcon size={14} />
            </Button>
            {hashCopied && <span className="copy-feedback-small">Copied!</span>}
          </div>
        )}
        <p id="participant-info" className="participant-info">
          {isConnected ? 'Peer joined. Communication is encrypted.' : 'Waiting for someone you trust'}
        </p>
      </div>
      <div className="header-actions">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Button
            className="btn--icon"
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
          disabled={disableStartCall || !isConnected}
        >
          <PhoneIcon size={20} />
        </Button>
        <Button
          className="btn--icon"
          variant="danger"
          onClick={handleDelete}
          title="Delete Chat"
          disabled={!channelHash}
        >
          <TrashIcon size={20} />
        </Button>
      </div>
    </header>
  );
};
