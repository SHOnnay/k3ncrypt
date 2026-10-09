import React from 'react';
import { useChat } from '../../context/ChatContext';
import { PlusIcon } from '../common/icons';
import { ApprovedIcon } from '../common/ApprovedIcon';
import { Avatar } from '../common/Avatar';
import { contactDisplayName, copy } from '../../content/copy';
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
  const { channelHash, messages, conversations, syncStatus, sessionHealth, profileDisplayName, protocolMode, unavailableConversations = [] } = useChat();
  const latest = messages.at(-1);

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
        <p className="section-label">Conversations</p>
        {conversations.map((conversation) => (
          <button key={conversation.roomId} className={`conversation-row ${!isWelcomeActive && channelHash === conversation.roomId ? 'active' : ''}`} type="button" onClick={() => onOpenConversation(conversation.roomId)}>
            <Avatar label={contactDisplayName(conversation.label, conversation.roomId, conversation.remoteDisplayName, conversation.localNickname)} size="medium" />
            <span className="conversation-copy">
              <span className="conversation-name-row"><span className="conversation-name">{contactDisplayName(conversation.label, conversation.roomId, conversation.remoteDisplayName, conversation.localNickname)}</span><time>{channelHash === conversation.roomId ? formatSidebarTime(latest?.timestamp) : ''}</time></span>
              <span className="conversation-preview">{conversation.bootstrapState === 'PENDING_REMOTE' || conversation.bootstrapState === 'PENDING_LOCAL' ? 'Waiting for contact to accept' : conversation.bootstrapState === 'FAILED_OR_UNSUPPORTED' ? 'Invitation needs a compatible link' : channelHash === conversation.roomId && protocolMode === 'modern' && sessionHealth !== 'healthy' ? 'Review connection' : channelHash === conversation.roomId && latest?.text ? latest.text : syncStatus === 'blocked' ? 'Review connection' : channelHash === conversation.roomId ? 'Conversation open' : 'Saved on this device'}</span>
            </span>
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="conversation-placeholder"><strong>{copy.contactsEmpty.title}</strong><span>{copy.contactsEmpty.description}</span></div>
        )}
      </div>

      {unavailableConversations.length > 0 && <details className="conversation-recovery"><summary>Unavailable conversations</summary><p>Some saved entries are not ready to open. Their encrypted data remains on this device.</p><p>Pending invitations appear in Chats only after someone accepts.</p></details>}
      <div className="sidebar-profile">
        <Avatar label={profileDisplayName} size="small" />
        <span><strong>{profileDisplayName}</strong><small>Your profile · this device</small></span>
        <button className="sidebar-settings" type="button" onClick={onOpenSettings} aria-label="Open settings"><ApprovedIcon name="settings" size={17} /></button>
      </div>
    </aside>
  );
};
