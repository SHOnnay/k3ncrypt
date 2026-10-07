import React, { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { Button } from '../common/Button';
import { PhoneIcon, PlusIcon, SearchIcon, VideoIcon } from '../common/icons';
import { contactDisplayName } from '../../content/copy';
import { callLaunchBlockMessage, callStartFailureMessage, getCallLaunchBlockReason } from '../../calls/callLaunchReadiness';
import './WorkspaceSection.css';

interface WorkspaceSectionProps {
  section: 'contacts' | 'calls';
  onOpenConversation: (roomId: string) => void;
  onNewConversation: () => void;
}

export const WorkspaceSection: React.FC<WorkspaceSectionProps> = ({ section, onOpenConversation, onNewConversation }) => {
  const [callMessage, setCallMessage] = useState('');
  const [startingCall, setStartingCall] = useState<'audio' | 'video'>();
  const [contactQuery, setContactQuery] = useState('');
  const { conversations, channelHash, isConnected, sessionHealth, protocolMode, contactIdentity, startCall, startVideoCall, callActive, setContactNickname } = useChat();
  const filteredConversations = useMemo(() => {
    const query = contactQuery.trim().toLocaleLowerCase();
    return conversations.filter((item) => !query || contactDisplayName(item.label, item.roomId, item.remoteDisplayName, item.localNickname).toLocaleLowerCase().includes(query));
  }, [contactQuery, conversations]);
  const active = conversations.find((conversation) => conversation.roomId === channelHash)
    ?? (protocolMode === 'legacy' && channelHash ? { roomId: channelHash, label: 'Private conversation', remoteDisplayName: undefined, localNickname: undefined } : undefined);
  const activeContactVerified = Boolean(active && active.roomId === channelHash && contactIdentity?.verification === 'verified' && contactIdentity.changeStatus === 'unchanged');
  const callLaunchBlockReason = getCallLaunchBlockReason({
    hasConversation: Boolean(active && active.roomId === channelHash),
    protocolMode,
    connected: isConnected,
    sessionHealth,
    verification: contactIdentity?.verification,
    changeStatus: contactIdentity?.changeStatus,
    callInProgress: callActive || startingCall !== undefined,
  });
  const launchCall = async (media: 'audio' | 'video'): Promise<void> => {
    setCallMessage('');
    setStartingCall(media);
    try {
      if (media === 'video') await startVideoCall();
      else await startCall();
      setCallMessage(media === 'video' ? 'Starting video call…' : 'Starting audio call…');
    } catch (error) {
      setCallMessage(callStartFailureMessage(error, media));
    } finally {
      setStartingCall(undefined);
    }
  };

  if (section === 'contacts') {
    return <main className="workspace-page">
      <header className="workspace-page__header"><div><span className="eyebrow">Your people</span><h1>Contacts</h1><p>People you have connected with on this device.</p></div><Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Add contact</Button></header>
      {conversations.length > 0 && <label className="workspace-search"><SearchIcon size={17} /><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search saved contacts" aria-label="Search saved contacts" /></label>}
      {filteredConversations.length ? <div className="workspace-contact-list">{filteredConversations.map((contact) => <div className="workspace-contact-shell" key={contact.roomId}>
        <button className="workspace-contact" onClick={() => onOpenConversation(contact.roomId)} type="button">
          <Avatar label={contactDisplayName(contact.label, contact.roomId, contact.remoteDisplayName, contact.localNickname)} size="large" />
          <span className="workspace-contact__copy"><strong>{contactDisplayName(contact.label, contact.roomId, contact.remoteDisplayName, contact.localNickname)}</strong><small>{contact.roomId === channelHash && sessionHealth !== 'healthy' ? 'Review connection security' : contact.roomId === channelHash ? 'Conversation open' : 'Saved on this device'}</small></span>
        </button>
        <button className="workspace-contact__edit" type="button" aria-label={`Edit nickname for ${contact.label}`} onClick={() => {
          const next = window.prompt('Contact nickname (saved only on this device; helps recognition and does not verify identity)', contact.label);
          if (next !== null) void setContactNickname(contact.roomId, next).catch(() => window.alert('Could not save this contact nickname.'));
        }}>Edit name</button>
      </div>)}</div> : conversations.length > 0 ? <div className="workspace-empty workspace-empty--compact"><h2>No matching contact</h2><p>Try another search.</p></div> : <div className="workspace-empty"><span className="workspace-empty__mark"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span><h2>Your contacts will appear here</h2><p>Create or join an invitation. Compare security codes before marking a contact verified.</p></div>}
    </main>;
  }

  return <main className="workspace-page">
    <header className="workspace-page__header"><div><span className="eyebrow">Private communication</span><h1>Calls</h1><p>Start a voice or video call from a trusted, connected conversation.</p></div></header>
    {active ? <section className="call-launch-card">
      <div className="call-launch-card__person"><Avatar label={contactDisplayName(active.label, active.roomId, active.remoteDisplayName, active.localNickname)} size="large" /><div><strong>{contactDisplayName(active.label, active.roomId, active.remoteDisplayName, active.localNickname)}</strong><small>{activeContactVerified ? 'Verified contact · encrypted chat' : contactIdentity?.changeStatus === 'changed-pending-review' ? 'Identity changed · review required' : contactIdentity ? 'Not verified on this device' : 'Verification status unavailable'}</small></div></div>
      <div className="call-launch-card__actions"><Button variant="secondary" disabled={Boolean(callLaunchBlockReason)} onClick={() => void launchCall('audio')} aria-label="Start audio call"><PhoneIcon size={18} /> Voice call</Button><Button variant="primary" disabled={Boolean(callLaunchBlockReason)} onClick={() => void launchCall('video')} aria-label="Start video call"><VideoIcon size={18} /> Video call</Button></div>
      {callLaunchBlockReason && <p className="workspace-call-readiness" role="status">{callLaunchBlockMessage(callLaunchBlockReason)}</p>}
      {callMessage && <p className="workspace-feedback" role="status">{callMessage}</p>}
    </section> : <div className="workspace-empty"><span className="workspace-empty__mark"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span><h2>No active conversation</h2><p>Open a verified conversation to start a call.</p></div>}
    <section className="calls-note"><span className="calls-note__dot" /><p>Call history is saved locally in this device’s encrypted conversation history. Microphone or camera access is requested only when you start or accept a call.</p></section>
  </main>;
};
