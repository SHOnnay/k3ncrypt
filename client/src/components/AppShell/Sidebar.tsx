import React from 'react';
import { useChat } from '../../context/ChatContext';
import { PlusIcon, SettingsIcon, ShieldIcon } from '../common/icons';
import './AppShell.css';

interface SidebarProps {
  isWelcomeActive: boolean;
  onNewConversation: () => void;
  onOpenConversation: () => void;
  onOpenPrivacy: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isWelcomeActive, onNewConversation, onOpenConversation, onOpenPrivacy }) => {
  const { channelHash, messages, isConnected } = useChat();
  const latestMessage = messages.at(-1)?.text;

  return (
    <aside className="sidebar" aria-label="K3ncrypt navigation">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><ShieldIcon size={18} /></div>
        <div>
          <strong>K3ncrypt</strong>
          <span>Private messenger</span>
        </div>
      </div>

      <button className="new-conversation" type="button" onClick={onNewConversation}>
        <PlusIcon size={17} />
        New conversation
      </button>

      <div className="conversation-section">
        <p className="section-label">Conversations</p>
        {channelHash ? (
          <button className={`conversation-row ${!isWelcomeActive ? 'active' : ''}`} type="button" onClick={onOpenConversation}>
            <span className="conversation-avatar">P</span>
            <span className="conversation-copy">
              <span className="conversation-name">Private conversation</span>
              <span className="conversation-preview">{latestMessage || (isConnected ? 'Connected securely' : 'Waiting for peer')}</span>
            </span>
            <span className={`presence-dot ${isConnected ? 'online' : ''}`} aria-label={isConnected ? 'Peer connected' : 'Peer offline'} />
          </button>
        ) : (
          <div className="conversation-placeholder">Your private conversations will appear here.</div>
        )}
      </div>

      <button className="sidebar-settings" type="button" onClick={onOpenPrivacy}>
        <SettingsIcon size={17} />
        Privacy &amp; security
      </button>
    </aside>
  );
};
