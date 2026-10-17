import React from 'react';
import { useChat } from '../../context/ChatContext';
import { PlusIcon } from '../common/icons';
import { ApprovedIcon } from '../common/ApprovedIcon';
import { Avatar } from '../common/Avatar';
import { contactDisplayName, copy } from '../../content/copy';
import { classifySidebarConversations, conversationStateCopy } from '../../product/conversationEligibility';
import { conversationRowOpenStatus } from '../../product/conversationOpenCopy';
import './AppShell.css';

interface SidebarProps {
  isWelcomeActive: boolean;
  activeSection: 'chats' | 'contacts' | 'calls';
  onNavigate: (section: 'chats' | 'contacts' | 'calls') => void;
  onNewConversation: () => void;
  onOpenConversation: (roomId?: string) => void;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
}

const formatSidebarTime = (date?: Date): string => {
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
};

export const Sidebar: React.FC<SidebarProps> = ({ isWelcomeActive, activeSection, onNavigate, onNewConversation, onOpenConversation, onOpenSettings, settingsOpen = false }) => {
  const { channelHash, messages, conversations, syncStatus, sessionHealth, profileDisplayName, protocolMode, accountState, unavailableConversations = [], orphanedConversationRecords, setPendingInvitationDismissed, pendingConversation, conversationOpenError } = useChat();
  const latest = messages.at(-1);
  const groups = classifySidebarConversations(conversations, unavailableConversations);
  const displayName = (conversation: typeof conversations[number]) => contactDisplayName(conversation.label, conversation.roomId, conversation.remoteDisplayName, conversation.localNickname);
  const invitationName = (conversation: typeof conversations[number]) => conversation.localNickname ?? (conversation.label !== 'Private contact' ? conversation.label : `Invitation · ${conversation.roomId.slice(-4).toUpperCase()}`);
  const invitationExpiry = (conversation: typeof conversations[number]) => {
    const expiresAt = conversation.pendingInvitationExpiresAt ?? conversation.signedInvitation?.expiresAt;
    if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) < 0) return 'Expiry unavailable — reconnect to check';
    const date = new Date(expiresAt as number);
    if (!Number.isFinite(date.getTime())) return 'Expiry unavailable';
    const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    return (expiresAt as number) <= Date.now() ? `Expired ${formatted}` : `Expires ${formatted}`;
  };

  return (
    <aside className="sidebar" aria-label="K3ncrypt navigation">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></div>
        <div>
          <strong>K3ncrypt</strong>
          <span>Your private space</span>
        </div>
      </div>

      <button className="new-conversation" type="button" onClick={onNewConversation}>
        <PlusIcon size={17} />
        {copy.contact.title}
      </button>

      <nav className="primary-navigation" aria-label="Main navigation">
        <button type="button" className={activeSection === 'chats' ? 'active' : ''} onClick={() => onNavigate('chats')} aria-current={activeSection === 'chats' ? 'page' : undefined}><ApprovedIcon name="chat" /><span>Chats</span></button>
        <button type="button" className={activeSection === 'contacts' ? 'active' : ''} onClick={() => onNavigate('contacts')} aria-current={activeSection === 'contacts' ? 'page' : undefined}><ApprovedIcon name="contacts" /><span>Contacts</span></button>
        <button type="button" className={activeSection === 'calls' ? 'active' : ''} onClick={() => onNavigate('calls')} aria-current={activeSection === 'calls' ? 'page' : undefined}><ApprovedIcon name="call" /><span>Calls</span></button>
        <button type="button" className={settingsOpen ? 'active' : ''} onClick={onOpenSettings} aria-current={settingsOpen ? 'page' : undefined}><ApprovedIcon name="settings" /><span>Settings</span></button>
      </nav>

      <div className="conversation-section">
        <section aria-labelledby="sidebar-chats-heading">
        <p className="section-label" id="sidebar-chats-heading">Chats</p>
        {groups.chats.map((conversation) => {
          const diagnostic = unavailableConversations.find(item => item.roomId === conversation.roomId);
          const openStatus = conversationRowOpenStatus(conversation.roomId, { pending: pendingConversation, error: conversationOpenError });
          const isActive = !isWelcomeActive && channelHash === conversation.roomId;
          return (
          <button key={conversation.roomId} className={`conversation-row ${isActive ? 'active' : ''}`} type="button" aria-current={isActive ? 'true' : undefined} aria-busy={pendingConversation?.roomId === conversation.roomId ? true : undefined} onClick={() => onOpenConversation(conversation.roomId)}>
            <Avatar label={displayName(conversation)} size="medium" />
            <span className="conversation-copy">
              <span className="conversation-name-row"><span className="conversation-name">{displayName(conversation)}</span><time>{channelHash === conversation.roomId ? formatSidebarTime(latest?.timestamp) : ''}</time></span>
              <span className="conversation-preview">{openStatus ?? (diagnostic ? conversationStateCopy(diagnostic) : conversation.bootstrapState === 'PENDING_REMOTE' || conversation.bootstrapState === 'PENDING_LOCAL' || conversation.relationship === 'invitation' && !conversation.remoteAddress ? 'Waiting for contact to accept' : conversation.bootstrapState === 'FAILED_OR_UNSUPPORTED' ? 'Invitation needs a compatible link' : channelHash === conversation.roomId && protocolMode === 'modern' && sessionHealth !== 'healthy' ? 'Review connection' : channelHash === conversation.roomId && latest?.text ? latest.text : syncStatus === 'blocked' ? 'Review connection' : channelHash === conversation.roomId ? 'Conversation open' : 'Saved on this device')}</span>
            </span>
          </button>
        ); })}
        {groups.chats.length === 0 && (
          <div className="conversation-placeholder"><strong>{copy.contactsEmpty.title}</strong><span>{copy.contactsEmpty.description}</span></div>
        )}
        </section>
        <section className="sidebar-record-group" aria-labelledby="sidebar-pending-heading">
          <p className="section-label" id="sidebar-pending-heading">Pending Invitations</p>
          {groups.pendingInvitations.filter(invitation => !invitation.locallyDismissed).length === 0 ? <p className="sidebar-group-empty">No pending invitations</p> : groups.pendingInvitations.filter(invitation => !invitation.locallyDismissed).map(invitation => (
            <div className="pending-invitation-row" key={invitation.roomId}>
              <button className="conversation-row" type="button" onClick={() => onOpenConversation(invitation.roomId)} aria-label={`Open pending invitation ${invitationName(invitation)}`}>
                <Avatar label={invitationName(invitation)} size="medium" />
                <span className="conversation-copy"><span className="conversation-name">{invitationName(invitation)}</span><span className="conversation-preview">{invitationExpiry(invitation)}</span></span>
              </button>
              <button className="invitation-local-action" type="button" disabled={accountState !== 'ready'} onClick={() => void setPendingInvitationDismissed(invitation.roomId, true).catch(() => window.alert('Could not dismiss this invitation locally. No invitation data was removed.'))}>Dismiss on this device</button>
            </div>
          ))}
          {groups.pendingInvitations.some(invitation => invitation.locallyDismissed) && <details className="dismissed-invitations"><summary>Dismissed on this device ({groups.pendingInvitations.filter(invitation => invitation.locallyDismissed).length})</summary>{groups.pendingInvitations.filter(invitation => invitation.locallyDismissed).map(invitation => <div className="pending-invitation-row" key={invitation.roomId}><span className="conversation-copy"><strong className="conversation-name">{invitationName(invitation)}</strong><span className="conversation-preview">{invitationExpiry(invitation)}</span></span><button className="invitation-local-action" type="button" disabled={accountState !== 'ready'} onClick={() => void setPendingInvitationDismissed(invitation.roomId, false).catch(() => window.alert('Could not restore this invitation. Its saved data remains unchanged.'))}>Restore</button></div>)}</details>}
        </section>
        <section className="sidebar-record-group" aria-labelledby="sidebar-unavailable-heading">
          <p className="section-label" id="sidebar-unavailable-heading">Unavailable Conversations</p>
          {groups.unavailable.length === 0 ? <p className="sidebar-group-empty">No unavailable conversations</p> : <ul className="unavailable-list">{groups.unavailable.map((item, index) => {
            const saved = item.roomId ? conversations.find(conversation => conversation.roomId === item.roomId) : undefined;
            return <li key={`${item.roomId ?? 'entry'}-${index}`}>
              {saved ? <button className="unavailable-conversation-action" type="button" onClick={() => onOpenConversation(saved.roomId)}><strong>{item.label}</strong><span className="conversation-preview">{conversationStateCopy(item)}</span></button> : <><strong>{item.label}</strong><span>{conversationStateCopy(item)}</span></>}
              {item.code && <small>{item.code}</small>}
            </li>;
          })}</ul>}
        </section>
      </div>

      {orphanedConversationRecords && <details className="conversation-recovery"><summary>Local record diagnostic</summary>{!orphanedConversationRecords.available ? <p>Record inspection is unavailable; no recovery claim can be made.</p> : <><p>{orphanedConversationRecords.roomIds.length} rooms have protocol/session records without a matching saved access descriptor. This count does not check contact identities, session usability or server availability. A missing access capability cannot be recovered automatically.</p><ul>{orphanedConversationRecords.roomIds.map(roomId => <li key={roomId}>Saved room · {roomId.slice(-8)}</li>)}</ul>{orphanedConversationRecords.truncated && <p>Inspection reached its safe limit; additional records may exist.</p>}</>}</details>}
      <div className="sidebar-profile">
        <Avatar label={profileDisplayName} size="small" />
        <span><strong>{profileDisplayName}</strong><small>Your profile · this device</small></span>
        <button className="sidebar-settings" type="button" onClick={onOpenSettings} aria-label="Open settings"><ApprovedIcon name="settings" size={17} /></button>
      </div>
    </aside>
  );
};
