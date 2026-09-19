import React from 'react';
import { useChat } from '../../context/ChatContext';
import { PlusIcon, SettingsIcon } from '../common/icons';
import { Avatar } from '../common/Avatar';
import { copy } from '../../content/copy';
import './AppShell.css';

interface SidebarProps {
  isWelcomeActive: boolean;
  onNewConversation: () => void;
  onOpenConversation: () => void;
  onOpenSettings: () => void;
}

const formatSidebarTime = (date?: Date): string => {
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
};

export const Sidebar: React.FC<SidebarProps> = ({ isWelcomeActive, onNewConversation, onOpenConversation, onOpenSettings }) => {
  const { channelHash, messages, isConnected } = useChat();
  const latest = messages.at(-1);

  return (
    <aside className="sidebar" aria-label="K3ncrypt navigation">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">K</div>
        <div>
          <strong>K3ncrypt</strong>
          <span>Your private space</span>
        </div>
      </div>

      <button className="new-conversation" type="button" onClick={onNewConversation}>
        <PlusIcon size={17} />
        {copy.contact.title}
      </button>

      <div className="conversation-section">
        <p className="section-label">Conversations</p>
        {channelHash ? (
          <button className={`conversation-row ${!isWelcomeActive ? 'active' : ''}`} type="button" onClick={onOpenConversation}>
            <Avatar label="Private conversation" size="medium" status={isConnected ? 'online' : 'offline'} />
            <span className="conversation-copy">
              <span className="conversation-name-row"><span className="conversation-name">Private conversation</span><time>{formatSidebarTime(latest?.timestamp)}</time></span>
              <span className="conversation-preview">{latest?.text || (isConnected ? 'Together now' : 'Waiting for someone you trust')}</span>
            </span>
          </button>
        ) : (
          <div className="conversation-placeholder"><strong>{copy.empty.title}</strong><span>{copy.empty.description}</span></div>
        )}
      </div>

      <div className="sidebar-profile">
        <Avatar label="You" size="small" />
        <span><strong>Your space</strong><small>On this device</small></span>
        <button className="sidebar-settings" type="button" onClick={onOpenSettings} aria-label="Open settings"><SettingsIcon size={17} /></button>
      </div>
    </aside>
  );
};
