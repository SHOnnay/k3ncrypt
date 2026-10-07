/**
 * Chat header component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { CopyIcon, ShareIcon, PhoneIcon, TrashIcon, VideoIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import { StatusPill } from '../common/StatusPill';
import { deriveSecurityVisibility } from '../../product/securityVisibility';
import { callLaunchBlockMessage, getCallLaunchBlockReason } from '../../calls/callLaunchReadiness';
import './SecurityVisibility.css';
import './ChatHeader.css';
import { debugError } from '../../utils/debug';
import { contactDisplayName } from '../../content/copy';

interface ChatHeaderProps {
  onStartCall: () => void;
  onStartVideoCall: () => void;
  disableStartCall?: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onStartCall, onStartVideoCall, disableStartCall = false }) => {
  const { isConnected, channelHash, deleteChannel, protocolMode, sessionHealth, conversations, contactIdentity } = useChat();
  const [hashCopied, setHashCopied] = useState(false);
  const activeConversation = conversations.find((conversation) => conversation.roomId === channelHash)
    ?? (protocolMode === 'legacy' && channelHash ? { roomId: channelHash, label: 'Private conversation', remoteDisplayName: undefined, localNickname: undefined } : undefined);
  const contactLabel = contactDisplayName(activeConversation?.label, activeConversation?.roomId, activeConversation?.remoteDisplayName, activeConversation?.localNickname);
  const securityVisibility = deriveSecurityVisibility({
    contact: protocolMode === 'modern' ? contactIdentity : undefined,
    sessionHealth: protocolMode === 'modern' ? sessionHealth : undefined,
    protocol: protocolMode,
  });
  const callLaunchBlockReason = getCallLaunchBlockReason({
    hasConversation: Boolean(activeConversation && activeConversation.roomId === channelHash),
    protocolMode,
    connected: isConnected,
    sessionHealth,
    verification: contactIdentity?.verification,
    changeStatus: contactIdentity?.changeStatus,
    callInProgress: disableStartCall,
  });

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
      <Avatar label={contactLabel} size="medium" />
      <div className="header-info">
        <div className="title-row">
          <h2 className="channel-title">{contactLabel}</h2>
          {activeConversation && <StatusPill tone="neutral">{protocolMode === 'modern' ? 'Encrypted chat' : 'Private chat'}</StatusPill>}
          {activeConversation && <StatusPill tone={securityVisibility.verification === 'verified' ? 'positive' : 'quiet'}>{securityVisibility.badgeLabel}</StatusPill>}
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
        <p id="participant-info" className="participant-info" role={securityVisibility.identityChange === 'changed-pending-review' ? 'alert' : undefined}>
          {securityVisibility.identityChange === 'changed-pending-review' ? 'Identity changed. K3NCRYPT can’t confirm this is the same person or device anymore. Compare the new security code before verifying again.' : activeConversation && (protocolMode === 'modern' && sessionHealth === 'unhealthy' ? 'Review the security update for this conversation before continuing.' : protocolMode === 'modern' && sessionHealth === 'renewal-pending' ? 'Waiting for your contact to review the connection update.' : protocolMode === 'modern' ? 'Messages in this conversation are protected.' : 'This private conversation is open.')}
        </p>
        {callLaunchBlockReason && <p id="call-launch-reason" className="call-launch-reason" role="status">{callLaunchBlockMessage(callLaunchBlockReason)}</p>}
        {activeConversation && <details className="conversation-security-details">
          <summary>Security details</summary>
          <dl>
            <div><dt>Verification</dt><dd>{securityVisibility.verification === 'verified' ? 'Verified' : securityVisibility.verification === 'unverified' ? 'Unverified' : 'Not available'}</dd></div>
            <div><dt>Identity change</dt><dd>{securityVisibility.identityChange === 'unchanged' ? 'No change reported' : securityVisibility.identityChange === 'changed-pending-review' ? 'Changed · review required' : 'Not available'}</dd></div>
            <div><dt>Message path</dt><dd>{securityVisibility.transport === 'relay' ? 'Relay' : 'Not available'}</dd></div>
            <div><dt>Relay connection</dt><dd>{securityVisibility.relayAvailability === 'not-exposed' ? 'Not exposed in this view' : 'Unknown'}</dd></div>
            <div><dt>Session</dt><dd>{securityVisibility.session === 'healthy' ? 'Healthy' : securityVisibility.session === 'unhealthy' ? 'Unavailable' : securityVisibility.session === 'renewal-pending' ? 'Renewal pending' : 'Not available'}</dd></div>
          </dl>
          <p>Relay acknowledgements are not signed peer receipts. They do not prove that a message was displayed or read.</p>
        </details>}
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
          aria-label="Start audio call"
          aria-describedby={callLaunchBlockReason ? 'call-launch-reason' : undefined}
          disabled={Boolean(callLaunchBlockReason)}
        >
          <PhoneIcon size={20} />
        </Button>
        <Button
          className="btn--icon"
          variant="secondary"
          onClick={onStartVideoCall}
          title="Start Video Call"
          aria-label="Start video call"
          aria-describedby={callLaunchBlockReason ? 'call-launch-reason' : undefined}
          disabled={Boolean(callLaunchBlockReason)}
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
