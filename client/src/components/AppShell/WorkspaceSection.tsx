import React, { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { Button } from '../common/Button';
import { PhoneIcon, PlusIcon, SearchIcon, VideoIcon } from '../common/icons';
import './WorkspaceSection.css';

interface WorkspaceSectionProps {
  section: 'contacts' | 'calls';
  onOpenConversation: (roomId: string) => void;
  onNewConversation: () => void;
}

export const WorkspaceSection: React.FC<WorkspaceSectionProps> = ({ section, onOpenConversation, onNewConversation }) => {
  const [callMessage, setCallMessage] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const { conversations, channelHash, isConnected, sessionHealth, protocolMode, startCall, startVideoCall, callLifecycleState } = useChat();
  const filteredConversations = useMemo(() => {
    const query = contactQuery.trim().toLocaleLowerCase();
    return conversations.filter((item) => !query || item.label.toLocaleLowerCase().includes(query));
  }, [contactQuery, conversations]);
  const active = conversations.find((conversation) => conversation.roomId === channelHash)
    ?? (channelHash ? { roomId: channelHash, label: 'Private conversation' } : undefined);
  const callReady = Boolean(active && isConnected && sessionHealth === 'healthy' && callLifecycleState === 'idle');

  if (section === 'contacts') {
    return <main className="workspace-page">
      <header className="workspace-page__header"><div><span className="eyebrow">Your people</span><h1>Contacts</h1><p>Private conversations saved on this device.</p></div><Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Add contact</Button></header>
      {conversations.length > 0 && <label className="workspace-search"><SearchIcon size={17} /><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search saved contacts" aria-label="Search saved contacts" /></label>}
      {filteredConversations.length ? <div className="workspace-contact-list">{filteredConversations.map((contact) => <button className="workspace-contact" key={contact.roomId} onClick={() => onOpenConversation(contact.roomId)} type="button">
        <Avatar label={contact.label} size="large" status={contact.roomId === channelHash && isConnected ? 'online' : 'offline'} />
        <span className="workspace-contact__copy"><strong>{contact.label}</strong><small>{contact.roomId === channelHash && sessionHealth !== 'healthy' ? 'Security update required' : contact.roomId === channelHash && isConnected ? 'Secure connection established' : 'Saved on this device'}</small></span>
        <span className="workspace-contact__chevron" aria-hidden="true">›</span>
      </button>)}</div> : conversations.length > 0 ? <div className="workspace-empty workspace-empty--compact"><h2>No matching contact</h2><p>Try another search.</p></div> : <div className="workspace-empty"><span className="workspace-empty__mark"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span><h2>Your contacts will appear here</h2><p>Create or join a private conversation to connect with someone you trust.</p><Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Add contact</Button></div>}
    </main>;
  }

  return <main className="workspace-page">
    <header className="workspace-page__header"><div><span className="eyebrow">Private communication</span><h1>Calls</h1><p>Start a voice or video call from a trusted, connected conversation.</p></div></header>
    {active ? <section className="call-launch-card">
      <div className="call-launch-card__person"><Avatar label={active.label} size="large" status={isConnected ? 'online' : 'offline'} /><div><strong>{active.label}</strong><small>{sessionHealth === 'healthy' && isConnected ? 'Verified contact · secure connection' : 'Connect and complete any security update before calling'}</small></div></div>
      <div className="call-launch-card__actions"><Button variant="secondary" disabled={!callReady} onClick={() => void startCall().then(() => setCallMessage('Calling…')).catch(() => setCallMessage('Call could not start. Check the secure connection and microphone permission.'))}><PhoneIcon size={18} /> Voice call</Button><Button variant="primary" disabled={!callReady || protocolMode !== 'legacy'} onClick={() => void startVideoCall().then(() => setCallMessage('Calling…')).catch(() => setCallMessage('Video call could not start. Check the secure connection and device permissions.'))}><VideoIcon size={18} /> Video call</Button></div>
      {callMessage && <p className="workspace-feedback" role="status">{callMessage}</p>}
    </section> : <div className="workspace-empty"><span className="workspace-empty__mark"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span><h2>No active conversation</h2><p>Open a saved contact before starting a call. Call authorization remains tied to that conversation.</p></div>}
    <section className="calls-note"><span className="calls-note__dot" /><p>Call controls appear when a call is active. Your browser will ask for microphone or camera access only when you start or accept a call.</p></section>
  </main>;
};
