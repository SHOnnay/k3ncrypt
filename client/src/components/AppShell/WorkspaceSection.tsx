import React, { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { Button } from '../common/Button';
import { PhoneIcon, PlusIcon, SearchIcon, VideoIcon } from '../common/icons';
import { contactDisplayName } from '../../content/copy';
import { callLaunchBlockMessage, callStartFailureMessage, getCallLaunchBlockReason } from '../../calls/callLaunchReadiness';
import { classifySidebarConversations, conversationStateCopy } from '../../product/conversationEligibility';
import { ConversationArchiveButton } from './ConversationArchiveButton';
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
  const { conversations, savedConversations = conversations, savedContactVerification = {}, unavailableConversations = [], channelHash, isConnected, sessionHealth, protocolMode, contactIdentity, startCall, startVideoCall, callActive, setContactNickname } = useChat();
  const groups = useMemo(() => classifySidebarConversations(savedConversations, unavailableConversations), [savedConversations, unavailableConversations]);
  const displayName = (item: typeof conversations[number]) => contactDisplayName(item.label, item.roomId, item.remoteDisplayName, item.localNickname);
  const verificationCopy = { verified: 'Verified on this device', unverified: 'Not verified on this device', 'review-required': 'Identity changed — review required', unknown: 'Verification unavailable — open Security to review' };
  const filteredConversations = useMemo(() => {
    const query = contactQuery.trim().toLocaleLowerCase();
    return groups.chats.filter((item) => !query || contactDisplayName(item.label, item.roomId, item.remoteDisplayName, item.localNickname).toLocaleLowerCase().includes(query));
  }, [contactQuery, groups.chats]);
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
      <header className="workspace-page__header"><div><span className="eyebrow">Your people</span><h1>Contacts</h1><p>Saved conversations on this device. Names and nicknames do not prove identity.</p></div><Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Add contact</Button></header>
      <p className="workspace-feedback">Names and nicknames help recognition. Only “Verified on this device” reflects a saved verification decision.</p>
      {groups.chats.length > 0 && <label className="workspace-search"><SearchIcon size={17} /><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search saved contacts" aria-label="Search saved contacts" /></label>}
      {filteredConversations.length ? <div className="workspace-contact-list">{filteredConversations.map((contact) => <div className="workspace-contact-shell" key={contact.roomId}>
        <button className="workspace-contact" onClick={() => onOpenConversation(contact.roomId)} type="button">
          <Avatar label={contactDisplayName(contact.label, contact.roomId, contact.remoteDisplayName, contact.localNickname)} size="large" />
          <span className="workspace-contact__copy"><strong>{displayName(contact)}</strong><small>{verificationCopy[savedContactVerification[contact.roomId] ?? 'unknown']}</small>{unavailableConversations.find(item => item.roomId === contact.roomId) && <small>{conversationStateCopy(unavailableConversations.find(item => item.roomId === contact.roomId)!)}</small>}</span>
        </button>
        <button className="workspace-contact__edit" type="button" aria-label={`Edit nickname for ${contact.label}`} onClick={() => {
          const next = window.prompt('Contact nickname (saved only on this device; helps recognition and does not verify identity)', contact.label);
          if (next !== null) void setContactNickname(contact.roomId, next).catch(() => window.alert('Could not save this contact nickname.'));
        }}>Edit name</button>
        <ConversationArchiveButton roomId={contact.roomId} name={displayName(contact)} />
      </div>)}</div> : groups.chats.length > 0 ? <div className="workspace-empty workspace-empty--compact"><h2>No matching contact</h2><p>Try another search.</p></div> : <div className="workspace-empty workspace-empty--compact"><h2>No saved contacts in the ordinary list</h2><p>Invitations, unavailable records and archived conversations are separate below. Compare security codes before marking any contact verified.</p></div>}
      {groups.pendingInvitations.length > 0 && <section className="workspace-records" aria-label="Pending invitations"><h2>Pending invitations</h2><p>These are invitations, not established contacts.</p>{groups.pendingInvitations.map(item => {
        const expiresAt = item.signedInvitation?.expiresAt ?? item.pendingInvitationExpiresAt;
        return <div className="workspace-record" key={item.roomId}><strong>{displayName(item)}</strong><p>{expiresAt !== undefined && expiresAt <= Date.now() ? 'Invitation expired. This does not delete any established contact.' : item.locallyDismissed ? 'Dismissed invitation — retained on this device.' : 'Waiting for contact acceptance.'}</p><ConversationArchiveButton roomId={item.roomId} name={displayName(item)} /></div>;
      })}</section>}
      {groups.unavailable.length > 0 && <section className="workspace-records" aria-label="Unavailable saved conversations"><h2>Unavailable saved conversations</h2><p>Access is paused. These entries are not proof of a verified contact.</p>{groups.unavailable.map((item, index) => <div className="workspace-record" key={`${item.roomId ?? 'invalid'}-${index}`}><strong>{item.label}</strong><p>{conversationStateCopy(item)}</p>{item.roomId && item.code !== 'CONVERSATION_RECORD_INVALID' && item.code !== 'CONVERSATION_LOCAL_RECORD_INVALID' && savedConversations.some(saved => saved.roomId === item.roomId) && <ConversationArchiveButton roomId={item.roomId} name={item.label} />}{item.code && <details><summary>Technical details</summary><small>{item.code}</small></details>}</div>)}</section>}
      {groups.archived.length > 0 && <details className="workspace-records" aria-label="Archived conversations"><summary>Archived conversations ({groups.archived.length})</summary><p>Hidden from ordinary lists on this device. History, identities and verification are retained. Restoring visibility does not restore missing server access.</p>{groups.archived.map(item => <div className="workspace-record" key={item.roomId}><strong>{displayName(item)}</strong><ConversationArchiveButton roomId={item.roomId} name={displayName(item)} restore /></div>)}</details>}
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
