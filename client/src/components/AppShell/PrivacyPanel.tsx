import React from 'react';
import { useChat } from '../../context/ChatContext';
import { CloseIcon, LockIcon, ShieldIcon } from '../common/icons';
import './AppShell.css';

interface PrivacyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPanel: React.FC<PrivacyPanelProps> = ({ isOpen, onClose }) => {
  const { channelHash } = useChat();

  if (!isOpen) return null;

  return (
    <aside className="privacy-panel open" aria-label="Privacy and security">
      <div className="privacy-heading">
        <div>
          <span className="eyebrow">Conversation details</span>
          <h2>Privacy &amp; security</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close privacy panel"><CloseIcon size={18} /></button>
      </div>

      <div className="security-card">
        <span className="security-icon"><ShieldIcon size={20} /></span>
        <div><strong>Encrypted in transit</strong><p>Messages use the current invite-secret encryption session.</p></div>
      </div>
      <div className="privacy-list">
        <div><span>Room reference</span><code>{channelHash ? `${channelHash.slice(0, 8)}…` : 'Not connected'}</code></div>
        <div><span>Message retention</span><strong>Server relay only</strong></div>
        <div><span>External fonts</span><strong>None</strong></div>
        <div><span>Default call routing</span><strong>No ICE servers</strong></div>
      </div>

      <div className="coming-later">
        <LockIcon size={18} />
        <div><strong>Persistent identity</strong><p>Device identity, verification, and secure history are coming later.</p></div>
      </div>
    </aside>
  );
};
