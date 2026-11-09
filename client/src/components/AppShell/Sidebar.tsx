import { callRowSummary } from '../../product/callHistory';
import { badgeLabel } from '../../product/alerts';
import { contactsCopy } from '../../content/checkCopy';
import React from 'react';
import { useChat } from '../../context/ChatContext';
import { PlusIcon } from '../common/icons';
import { ApprovedIcon } from '../common/ApprovedIcon';
import { Avatar } from '../common/Avatar';
import { contactDisplayName, copy } from '../../content/copy';
import { classifySidebarConversations, conversationStateCopy, plainConversationState } from '../../product/conversationEligibility';
import { conversationRowOpenStatus } from '../../product/conversationOpenCopy';
import { ConversationArchiveButton } from './ConversationArchiveButton';
import './AppShell.css';

/** Chats settle in once per page load. The window outlasts the animation, so re-renders during it don't cancel it. */
const SETTLE_WINDOW_MS = 1_000;
let settleEndsAt: number | undefined;
export const shouldSettleRows = (hasRows: boolean, now: number): boolean => {
  if (!hasRows) return false;
  settleEndsAt ??= now + SETTLE_WINDOW_MS;
  return now < settleEndsAt;
};
export const resetRowSettleForTest = (): void => { settleEndsAt = undefined; };

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
  const { channelHash, messages, conversations, savedConversations = conversations, sessionHealth, profileDisplayName, protocolMode, unavailableConversations = [], pendingConversation, conversationOpenError, accountState, unreadCounts = {}, mutedChats = [], setChatMuted, notificationOffer, answerNotificationOffer } = useChat();
  // Item 4: nothing about contacts while locked. accountState becomes 'ready' only after vault.unlock()
  // succeeds (openModernVault), so names can appear during the rest of "Unlocking…" but never before.
  if (accountState === 'locked' || accountState === 'checking') return <LockedSidebar />;
  const latest = messages.at(-1);
  const groups = classifySidebarConversations(savedConversations, unavailableConversations);
  const settleRows = shouldSettleRows(groups.chats.length > 0, Date.now());
  const displayName = (conversation: typeof conversations[number]) => contactDisplayName(conversation.label, conversation.roomId, conversation.remoteDisplayName, conversation.localNickname);

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
        New conversation
      </button>

      <nav className="primary-navigation" aria-label="Main navigation">
        <button type="button" className={activeSection === 'chats' ? 'active' : ''} onClick={() => onNavigate('chats')} aria-current={activeSection === 'chats' ? 'page' : undefined}><ApprovedIcon name="chat" /><span>Chats</span></button>
        <button type="button" className={activeSection === 'contacts' ? 'active' : ''} onClick={() => onNavigate('contacts')} aria-current={activeSection === 'contacts' ? 'page' : undefined}><ApprovedIcon name="contacts" /><span>Contacts</span></button>
        <button type="button" className={activeSection === 'calls' ? 'active' : ''} onClick={() => onNavigate('calls')} aria-current={activeSection === 'calls' ? 'page' : undefined}><ApprovedIcon name="call" /><span>Calls</span></button>
        <button type="button" className={settingsOpen ? 'active' : ''} onClick={onOpenSettings} aria-current={settingsOpen ? 'page' : undefined}><ApprovedIcon name="settings" /><span>Settings</span></button>
      </nav>

      <div className="conversation-section">
        <section aria-labelledby="sidebar-chats-heading">
        <p className="section-label" id="sidebar-chats-heading">Conversations</p>
        {groups.chats.map((conversation, rowIndex) => {
          const diagnostic = unavailableConversations.find(item => item.roomId === conversation.roomId);
          const openStatus = conversationRowOpenStatus(conversation.roomId, { pending: pendingConversation, error: conversationOpenError });
          const isActive = !isWelcomeActive && channelHash === conversation.roomId;
          const unread = unreadCounts[conversation.roomId] ?? 0;
          const muted = mutedChats.includes(conversation.roomId);
          return (
          <div key={conversation.roomId} className="conversation-row-wrap">
          <button className={`conversation-row ${isActive ? 'active' : ''} ${settleRows ? 'conversation-row--settle' : ''}`} style={settleRows ? { '--row-index': rowIndex } as React.CSSProperties : undefined} type="button" aria-current={isActive ? 'true' : undefined} aria-busy={pendingConversation?.roomId === conversation.roomId ? true : undefined} onClick={() => onOpenConversation(conversation.roomId)}>
            <Avatar label={displayName(conversation)} size="medium" />
            <span className="conversation-copy">
              <span className="conversation-name-row"><span className="conversation-name">{displayName(conversation)}</span><time>{channelHash === conversation.roomId ? formatSidebarTime(latest?.timestamp) : ''}</time>{unread > 0 && <span className={`conversation-badge ${muted ? 'conversation-badge--muted' : ''}`} role="status" aria-label={`${unread} unread`}>{badgeLabel(unread)}</span>}</span>
              <span className="conversation-preview">{openStatus ?? (diagnostic ? conversationStateCopy(diagnostic) : conversation.bootstrapState === 'PENDING_REMOTE' || conversation.bootstrapState === 'PENDING_LOCAL' || conversation.relationship === 'invitation' && !conversation.remoteAddress ? 'Waiting for contact to accept' : conversation.bootstrapState === 'FAILED_OR_UNSUPPORTED' ? 'Invitation needs a compatible link' : channelHash === conversation.roomId && protocolMode === 'modern' && sessionHealth === 'unhealthy' ? 'Secure connection needs renewing' : channelHash === conversation.roomId && protocolMode === 'modern' && sessionHealth === 'renewal-pending' ? 'Waiting for your contact to confirm' : channelHash === conversation.roomId && latest?.callEvent ? callRowSummary(latest.callEvent).title : channelHash === conversation.roomId && latest?.text ? latest.text : channelHash === conversation.roomId ? 'Conversation open' : 'Saved on this device')}</span>
            </span>
          </button>
          {setChatMuted && <button type="button" className={`conversation-mute ${muted ? 'conversation-mute--on' : ''}`} aria-pressed={muted} aria-label={`${muted ? 'Unmute' : 'Mute'} ${displayName(conversation)}`} title={muted ? 'Muted: no sound, badge still shows' : 'Mute sound'} onClick={() => { void setChatMuted(conversation.roomId, !muted).catch(() => undefined); }}>{muted ? 'Muted' : 'Mute'}</button>}
          </div>
        ); })}
        {groups.chats.length === 0 && (
          <div className="conversation-placeholder"><strong>{contactsCopy.chatsEmptyTitle}</strong><span>{copy.contactsEmpty.description}</span></div>
        )}
        </section>
        {/* Own pending invitations are shown only on the Invite someone screen (Bug A). */}
        {groups.unavailable.length > 0 && <section className="sidebar-record-group" aria-labelledby="sidebar-unavailable-heading">
          <p className="section-label" id="sidebar-unavailable-heading">Needs attention</p>
          <ul className="unavailable-list">{groups.unavailable.map((item, index) => {
            const saved = item.roomId ? savedConversations.find(conversation => conversation.roomId === item.roomId) : undefined;
            return <li key={`${item.roomId ?? 'entry'}-${index}`}>
              {saved ? <button className="unavailable-conversation-action" type="button" onClick={() => onOpenConversation(saved.roomId)}><strong>{item.label}</strong><span className="conversation-preview">{plainConversationState(item)}</span></button>
                : <><strong>{item.label}</strong><span className="conversation-preview">{plainConversationState(item)}</span></>}
              {saved && item.code !== 'CONVERSATION_RECORD_INVALID' && item.code !== 'CONVERSATION_LOCAL_RECORD_INVALID' && <ConversationArchiveButton roomId={saved.roomId} name={item.label} verb="Remove" className="invitation-local-action" />}
            </li>;
          })}</ul>
        </section>}
        {groups.archived.length > 0 && <button className="invitation-local-action" type="button" onClick={() => onNavigate('contacts')}>Archived conversations ({groups.archived.length}) — manage in Contacts</button>}
      </div>

      {notificationOffer && answerNotificationOffer && <div className="notification-offer" role="region" aria-label="Notifications">
        <span>Get a heads-up when a message arrives while this tab is in the background. It never shows what the message says unless you turn previews on in Settings.</span>
        <span className="notification-offer-actions">
          <button type="button" onClick={() => { void answerNotificationOffer(true); }}>Turn on</button>
          <button type="button" onClick={() => { void answerNotificationOffer(false); }}>Not now</button>
        </span>
      </div>}

      <div className="sidebar-profile">
        <Avatar label={profileDisplayName} size="small" />
        <span><strong>{profileDisplayName}</strong><small>Your profile · this device</small></span>
        <button className="sidebar-settings" type="button" onClick={onOpenSettings} aria-label="Open settings"><ApprovedIcon name="settings" size={17} /></button>
      </div>
    </aside>
  );
};

const LockedSidebar: React.FC = () => (
  <aside className="sidebar sidebar--locked" aria-label="K3ncrypt navigation">
    <div className="brand-row">
      <div className="brand-mark" aria-hidden="true"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></div>
      <div><strong>K3ncrypt</strong><span>Your private space</span></div>
    </div>
    <button className="new-conversation" type="button" disabled><PlusIcon size={17} />New conversation</button>
    <nav className="primary-navigation" aria-label="Main navigation">
      <button type="button" disabled><ApprovedIcon name="chat" /><span>Chats</span></button>
      <button type="button" disabled><ApprovedIcon name="contacts" /><span>Contacts</span></button>
      <button type="button" disabled><ApprovedIcon name="call" /><span>Calls</span></button>
      <button type="button" disabled><ApprovedIcon name="settings" /><span>Settings</span></button>
    </nav>
    <div className="conversation-section">
      <div className="conversation-placeholder" role="status"><strong>{contactsCopy.lockedTitle}</strong><span>{contactsCopy.lockedHelp}</span></div>
    </div>
  </aside>
);
