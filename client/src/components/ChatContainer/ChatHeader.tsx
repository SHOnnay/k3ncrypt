/**
 * Chat header component
 */

import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { CopyIcon, PhoneIcon, TrashIcon, VideoIcon } from '../common/icons';
import { ApprovedIcon } from '../common/ApprovedIcon';
import { Avatar } from '../common/Avatar';
import { StatusPill } from '../common/StatusPill';
import { deriveSecurityVisibility } from '../../product/securityVisibility';
import { callLaunchBlockMessage, getCallLaunchBlockReason } from '../../calls/callLaunchReadiness';
import './SecurityVisibility.css';
import './ChatHeader.css';
import { debugError } from '../../utils/debug';
import { contactDisplayName } from '../../content/copy';
import { checkCopy, checkName, checkState } from '../../content/checkCopy';
import { useOpenCheck } from '../../context/CheckContactContext';
import { useBrowserOnline } from '../../hooks/useBrowserOnline';
import { connectionStatus, connectionStatusCopy } from '../../product/connectionStatus';

interface ChatHeaderProps {
  onStartCall: () => void;
  onStartVideoCall: () => void;
  disableStartCall?: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onStartCall, onStartVideoCall, disableStartCall = false }) => {
  const { isConnected, channelHash, deleteChannel, protocolMode, sessionHealth, conversations, contactIdentity, pendingConversation, conversationOpenError } = useChat();
  const [hashCopied, setHashCopied] = useState(false);
  const openCheck = useOpenCheck();
  const browserOnline = useBrowserOnline();
  const status = connectionStatus(browserOnline, isConnected);
  const statusCopy = connectionStatusCopy(status);
  const activeConversation = conversations.find((conversation) => conversation.roomId === channelHash)
    ?? (protocolMode === 'legacy' && channelHash ? { roomId: channelHash, label: 'Private conversation', remoteDisplayName: undefined, localNickname: undefined } : undefined);
  const contactLabel = contactDisplayName(activeConversation?.label, activeConversation?.roomId, activeConversation?.remoteDisplayName, activeConversation?.localNickname);
  const roomLabel = (roomId: string) => {
    const conversation = conversations.find((item) => item.roomId === roomId);
    return contactDisplayName(conversation?.label, roomId, conversation?.remoteDisplayName, conversation?.localNickname);
  };
  const securityVisibility = deriveSecurityVisibility({
    contact: protocolMode === 'modern' ? contactIdentity : undefined,
    sessionHealth: protocolMode === 'modern' ? sessionHealth : undefined,
    protocol: protocolMode,
  });
  const contactCheck = protocolMode === 'modern' && contactIdentity ? checkState(contactIdentity) : undefined;
  const participantMessage = securityVisibility.identityChange === 'changed-pending-review'
    ? undefined
    : activeConversation && protocolMode === 'modern' && sessionHealth === 'unhealthy'
      ? `Your secure connection with ${checkName(contactLabel)} needs renewing.`
      : activeConversation && protocolMode === 'modern' && sessionHealth === 'renewal-pending'
        ? 'Waiting for your contact to review the connection update.'
        : undefined;
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
          {activeConversation && contactCheck === 'unchecked' && <Button className="btn--tiny check-header-button" variant="secondary" onClick={openCheck}>Check</Button>}
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
        {activeConversation && <p className={`connection-status connection-status--${status}`} role="status" aria-label="Connection"><span className="connection-status__dot" aria-hidden="true" /><strong>{statusCopy.label}</strong>{statusCopy.help && <span> {statusCopy.help}</span>}</p>}
        {participantMessage && <p id="participant-info" className="participant-info" role={securityVisibility.identityChange === 'changed-pending-review' ? 'alert' : 'status'}>{participantMessage}{sessionHealth === 'unhealthy' && <> <Button className="btn--tiny" variant="secondary" onClick={openCheck}>Review</Button></>}</p>}
        {pendingConversation && <p className="participant-info" role="status">Opening {roomLabel(pendingConversation.roomId)}… The current conversation remains active until it is ready.</p>}
        {conversationOpenError && <p className="participant-info" role="status">Could not open {roomLabel(conversationOpenError.roomId)}. Your current conversation remains open.</p>}
        {callLaunchBlockReason && <p id="call-launch-reason" className="call-launch-reason" role="status">{callLaunchBlockMessage(callLaunchBlockReason)}</p>}
      </div>
      <div className="header-actions">
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
        <details className="chat-more-menu">
          <summary className="btn btn--icon" aria-label="More conversation actions" title="More">
            <ApprovedIcon name="more" size={20} />
          </summary>
          <div className="chat-more-menu__panel">
            <button type="button" className="chat-more-menu__delete" onClick={handleDelete} disabled={!activeConversation}>
              <TrashIcon size={16} />
              Delete conversation
            </button>
          </div>
        </details>
      </div>
      {activeConversation && contactCheck === 'changed' && <div className="check-banner check-banner--changed check-banner--full" role="alert"><p>{checkCopy.changed(checkName(contactLabel))}</p><Button variant="primary" onClick={openCheck}>{checkCopy.checkAgain}</Button></div>}
    </header>
  );
};
