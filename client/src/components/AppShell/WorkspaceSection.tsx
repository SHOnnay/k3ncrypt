import { callRowSummary } from '../../product/callHistory';
import { CallOutcome } from '../ChatContainer/CallOutcome';
import { CHECK_PILL, contactsCopy } from '../../content/checkCopy';
import React, { useEffect, useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { Button } from '../common/Button';
import { PhoneIcon, PlusIcon, SearchIcon, VideoIcon } from '../common/icons';
import { contactDisplayName } from '../../content/copy';
import { callLaunchBlockMessage, callStartFailureMessage, getCallLaunchBlockReason } from '../../calls/callLaunchReadiness';
import { classifySidebarConversations, conversationStateCopy, plainConversationState } from '../../product/conversationEligibility';
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
  const { conversations, savedConversations = conversations, savedContactVerification = {}, unavailableConversations = [], channelHash, isConnected, sessionHealth, protocolMode, contactIdentity, startCall, startVideoCall, callActive, setContactNickname, callHistory = [], refreshCallHistory } = useChat();
  const groups = useMemo(() => classifySidebarConversations(savedConversations, unavailableConversations), [savedConversations, unavailableConversations]);
  const displayName = (item: typeof conversations[number]) => contactDisplayName(item.label, item.roomId, item.remoteDisplayName, item.localNickname);
  const verificationCopy: Record<string, string> = { verified: CHECK_PILL.checked, unverified: CHECK_PILL.unchecked, 'review-required': CHECK_PILL.changed, unknown: CHECK_PILL.unavailable };
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
  // UX A8: Calls page history and Call back. Call back opens that chat, then starts the call once it is the
  // active, checked, connected conversation; otherwise the existing plain reason is shown on the launch card.
  const [callBack, setCallBack] = useState<{ roomId: string; mode: 'audio' | 'video' }>();
  useEffect(() => { if (section === 'calls') void refreshCallHistory?.(); }, [section, refreshCallHistory]);
  useEffect(() => {
    if (!callBack) return undefined;
    if (channelHash === callBack.roomId && !callLaunchBlockReason) { setCallBack(undefined); void launchCall(callBack.mode); return undefined; }
    const expiry = setTimeout(() => setCallBack(undefined), 15_000);
    return () => clearTimeout(expiry);
  // launchCall is recreated each render; the trigger is the active room and readiness.
  }, [callBack, channelHash, callLaunchBlockReason]);

  if (section === 'contacts') {
    return <main className="workspace-page">
      <header className="workspace-page__header"><div><span className="eyebrow">Your people</span><h1>Contacts</h1><p>People you talk to on this device. Anyone can copy a name — checking shows it’s really them.</p></div><Button variant="primary" onClick={onNewConversation}><PlusIcon size={17} /> Add contact</Button></header>
      {groups.chats.length > 0 && <label className="workspace-search"><SearchIcon size={17} /><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search saved contacts" aria-label="Search saved contacts" /></label>}
      {filteredConversations.length ? <>{([['verified', contactsCopy.checkedGroup], ['unchecked', contactsCopy.uncheckedGroup]] as const).map(([group, heading]) => {
        const members = filteredConversations.filter((item) => (savedContactVerification[item.roomId] === 'verified') === (group === 'verified'));
        return members.length ? <section className="workspace-contact-group" key={group} aria-label={heading}><h2 className="workspace-contact-group__title">{heading} <span>({members.length})</span></h2><div className="workspace-contact-list">{members.map((contact) => <div className="workspace-contact-shell" key={contact.roomId}>
        <button className="workspace-contact" onClick={() => onOpenConversation(contact.roomId)} type="button">
          <Avatar label={contactDisplayName(contact.label, contact.roomId, contact.remoteDisplayName, contact.localNickname)} size="large" />
          <span className="workspace-contact__copy"><strong>{displayName(contact)}</strong><small>{verificationCopy[savedContactVerification[contact.roomId] ?? 'unknown']}</small>{unavailableConversations.find(item => item.roomId === contact.roomId) && <small>{conversationStateCopy(unavailableConversations.find(item => item.roomId === contact.roomId)!)}</small>}</span>
        </button>
        <button className="workspace-contact__edit" type="button" aria-label={`Edit nickname for ${contact.label}`} onClick={() => {
          const next = window.prompt('Contact nickname (saved only on this device; a name doesn’t show it’s really them)', contact.label);
          if (next !== null) void setContactNickname(contact.roomId, next).catch(() => window.alert('Could not save this contact nickname.'));
        }}>Edit name</button>
        <ConversationArchiveButton roomId={contact.roomId} name={displayName(contact)} />
      </div>)}</div></section> : null;
      })}</> : groups.chats.length > 0 ? <div className="workspace-empty workspace-empty--compact"><h2>No matching contact</h2><p>Try another search.</p></div> : <div className="workspace-empty workspace-empty--compact"><h2>{contactsCopy.emptyTitle}</h2><p>{contactsCopy.emptyHelp}</p></div>}
      {groups.unavailable.length > 0 && <section className="workspace-records" aria-label="Chats that need attention"><h2>Needs attention</h2><p>These chats are kept on this device. Each line says what’s wrong. Remove hides one from your lists; its history stays saved.</p>{groups.unavailable.map((item, index) => <div className="workspace-record" key={`${item.roomId ?? 'invalid'}-${index}`}><strong>{item.label}</strong><p>{plainConversationState(item)}</p>{item.roomId && item.code !== 'CONVERSATION_RECORD_INVALID' && item.code !== 'CONVERSATION_LOCAL_RECORD_INVALID' && savedConversations.some(saved => saved.roomId === item.roomId) && <ConversationArchiveButton roomId={item.roomId} name={item.label} verb="Remove" />}</div>)}</section>}
      {groups.archived.length > 0 && <details className="workspace-records" aria-label="Archived conversations"><summary>Archived conversations ({groups.archived.length})</summary><p>Hidden from ordinary lists on this device. History and checks are kept. Restoring visibility does not restore missing server access.</p>{groups.archived.map(item => <div className="workspace-record" key={item.roomId}><strong>{displayName(item)}</strong><ConversationArchiveButton roomId={item.roomId} name={displayName(item)} restore /></div>)}</details>}
    </main>;
  }

  return <main className="workspace-page">
    <header className="workspace-page__header"><div><span className="eyebrow">Private communication</span><h1>Calls</h1><p>Start a voice or video call from a trusted, connected conversation.</p></div></header>
    {active ? <section className="call-launch-card">
      <div className="call-launch-card__person"><Avatar label={contactDisplayName(active.label, active.roomId, active.remoteDisplayName, active.localNickname)} size="large" /><div><strong>{contactDisplayName(active.label, active.roomId, active.remoteDisplayName, active.localNickname)}</strong><small>{activeContactVerified ? 'Checked contact · encrypted chat' : contactIdentity?.changeStatus === 'changed-pending-review' ? 'Security number changed · check again' : contactIdentity ? 'Not checked yet' : 'Not available yet'}</small></div></div>
      <div className="call-launch-card__actions"><Button variant="secondary" disabled={Boolean(callLaunchBlockReason)} onClick={() => void launchCall('audio')} aria-label="Start audio call"><PhoneIcon size={18} /> Voice call</Button><Button variant="primary" disabled={Boolean(callLaunchBlockReason)} onClick={() => void launchCall('video')} aria-label="Start video call"><VideoIcon size={18} /> Video call</Button></div>
      {callLaunchBlockReason && <p className="workspace-call-readiness" role="status">{callLaunchBlockMessage(callLaunchBlockReason)}</p>}
      {callMessage && <p className="workspace-feedback" role="status">{callMessage}</p>}
      <CallOutcome roomId={active.roomId} />
    </section> : <div className="workspace-empty"><span className="workspace-empty__mark"><img src="/branding/k3ncrypt-cluster-white.svg" alt="" /></span><h2>No active conversation</h2><p>Open a checked contact’s chat to start a call.</p></div>}
    <section className="call-history" aria-labelledby="call-history-heading">
      <h2 id="call-history-heading">Recent calls</h2>
      {callHistory.length === 0 ? <p className="call-history__empty">No calls yet. Calls you make or receive appear here.</p> : <ul className="call-history__list">{callHistory.map((entry) => {
        const row = callRowSummary(entry.event); const kind = entry.event.mode === 'video' ? 'video' : 'voice';
        return <li key={`${entry.roomId}-${entry.id}`} className={`call-history-row call-history-row--${row.tone}`}>
          <Avatar label={entry.name} size="medium" />
          <span className="call-history-row__copy"><strong>{entry.name}</strong><small>{row.title}{row.duration ? ` · ${row.duration}` : ''}</small></span>
          <time className="call-history-row__time">{entry.timestamp.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
          <Button variant="secondary" className="btn--icon" aria-label={`Call back ${entry.name} (${kind})`} title={`Call back (${kind})`} disabled={callActive || startingCall !== undefined}
            onClick={() => { setCallMessage(''); setCallBack({ roomId: entry.roomId, mode: entry.event.mode }); if (channelHash !== entry.roomId) onOpenConversation(entry.roomId); }}>
            {entry.event.mode === 'video' ? <VideoIcon size={17} /> : <PhoneIcon size={17} />}
          </Button>
        </li>;
      })}</ul>}
    </section>
    <section className="calls-note"><span className="calls-note__dot" /><p>Call history is saved locally in this device’s encrypted conversation history. Microphone or camera access is requested only when you start or accept a call.</p></section>
  </main>;
};
