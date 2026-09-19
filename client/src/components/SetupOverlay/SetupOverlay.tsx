/**
 * Main SetupOverlay component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { parseInviteInput, parseModernInviteInput } from '../../utils/urlHash';
import { InitialActions } from './InitialActions';
import { CreateHashView } from './CreateHashView';
import { JoinHashView } from './JoinHashView';
import './SetupOverlay.css';
import { debugError } from '../../utils/debug';
import { copy } from '../../content/copy';

interface SetupOverlayProps {
  onSetupComplete: (roomId: string, secret: string, controlCapability: string) => Promise<void>;
  isHidden: boolean;
  onModernSetupComplete: (inviteLink: string) => void;
}

type ViewType = 'initial' | 'create' | 'join' | 'modern' | 'deleted';

export const SetupOverlay: React.FC<SetupOverlayProps> = ({ onSetupComplete, onModernSetupComplete, isHidden }) => {
  const { createNewChannel, createModernChannel, joinModernChannel } = useChat();
  const [view, setView] = useState<ViewType>('initial');
  const [invite, setInvite] = useState<{ roomId: string; secret: string; controlCapability: string; link: string } | null>(null);
  const [joinInput, setJoinInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [, setIsLoading] = useState<boolean>(false);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [modernInvite, setModernInvite] = useState('');

  // Generate the invitation (room id from the server + a locally generated secret) when entering create view
  const generateInvite = useCallback(async () => {
    try {
      setStatus('Generating a secure invitation...');
      const created = await createNewChannel();
      setInvite({ roomId: created.roomId, secret: created.secret, controlCapability: created.controlCapability, link: created.absoluteLink || created.link });
      setStatus('');
    } catch (err) {
      setStatus('Failed to generate invitation. Please try again.');
      debugError('Invitation generation failed', err);
    }
  }, [createNewChannel]);

  useEffect(() => {
    if (view === 'create' && !invite) {
      generateInvite();
    }
  }, [view, invite, generateInvite]);

  useEffect(() => {
    if (view === 'join' && !joinInput && parseModernInviteInput(window.location.hash)) {
      setJoinInput(window.location.hash);
    }
  }, [view, joinInput]);

  const handleCreateClick = () => {
    setView('create');
  };

  const handleJoinClick = () => {
    setView('join');
  };

  const handleBack = () => {
    setView('initial');
    setInvite(null);
    setJoinInput('');
    setStatus('');
    setModernInvite('');
  };

  const handleCopyHash = () => {
    if (invite) {
      navigator.clipboard.writeText(invite.link);
    }
  };

  const handleCreateNext = async () => {
    if (!invite) {
      setStatus('Please generate an invitation first.');
      return;
    }
    try {
      setIsLoading(true);
      setStatus('Connecting...');
      await onSetupComplete(invite.roomId, invite.secret, invite.controlCapability);
    } catch (err) {
      setStatus('Failed to connect. Please try again.');
      debugError('Conversation setup failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinNext = async () => {
    const modern = parseModernInviteInput(joinInput);
    if (modern) {
      const passphrase = passphraseRef.current?.value ?? '';
      if (passphraseRef.current) passphraseRef.current.value = '';
      try {
        setStatus('Opening your private contact…');
        await joinModernChannel(modern.roomId, modern.controlCapability, modern.address, passphrase);
        onModernSetupComplete(`${window.location.origin}${window.location.pathname}#modern=${encodeURIComponent(modern.roomId)}&control=${encodeURIComponent(modern.controlCapability)}&address=${encodeURIComponent(modern.address)}`);
        setStatus('');
      } catch { setStatus('Could not open this contact. Check the invitation and local passphrase.'); }
      return;
    }
    const parsed = parseInviteInput(joinInput);
    if (!parsed) {
      setStatus('Please enter a valid invitation link.');
      return;
    }
    try {
      setIsLoading(true);
      setStatus('Connecting...');
      await onSetupComplete(parsed.roomId, parsed.secret, parsed.controlCapability);
    } catch (err: any) {
      if (err.message === 'CHANNEL_DELETED') {
        setView('deleted');
        setStatus('');
      } else {
        setStatus('Failed to join channel. Please check the invitation link and try again.');
      }
      debugError('Conversation join failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModernCreate = async () => {
    const passphrase = passphraseRef.current?.value ?? '';
    if (passphraseRef.current) passphraseRef.current.value = '';
    try {
      setStatus('Creating your private contact…');
      const link = await createModernChannel(passphrase);
      setModernInvite(link);
      setStatus('Share this invitation with one person you trust.');
    } catch { setStatus('Could not create this contact. Use a passphrase of at least 12 characters, or unlock this device with the existing one.'); }
  };

  const heading = view === 'initial' ? copy.welcome.title : view === 'create' ? copy.contact.title : view === 'join' ? 'Open an invitation' : view === 'modern' ? 'A private contact' : 'Conversation closed';
  const description = view === 'initial'
    ? copy.welcome.tagline
    : view === 'create'
      ? 'Share this invitation with one person you trust.'
      : view === 'join'
        ? 'Paste the invitation someone shared with you.'
        : view === 'modern'
          ? 'Start a new private conversation with a lasting identity on this device.'
        : 'This invitation is no longer available.';

  return (
    <div className={`overlay ${isHidden ? 'hidden' : ''}`}>
      <div className="overlay-content">
        <div className="welcome-wordmark" aria-hidden="true">K</div>
        <span className="welcome-kicker">A place for your people</span>
        <h1>{heading}</h1>
        <p>{description}</p>

        {view === 'initial' && (
          <InitialActions
            onCreateClick={handleCreateClick}
            onJoinClick={handleJoinClick}
          />
        )}
        {view === 'initial' && <button className="restore-identity" type="button" onClick={() => setView('modern')}>Create a private contact · modern mode</button>}

        {view === 'create' && (
          <CreateHashView
            inviteLink={invite?.link || ''}
            onCopyClick={handleCopyHash}
            onBack={handleBack}
            onNext={handleCreateNext}
          />
        )}

        {view === 'join' && (
          <>
            <JoinHashView inviteInput={joinInput} onInviteInputChange={setJoinInput} onBack={handleBack} onJoin={handleJoinNext} />
            {parseModernInviteInput(joinInput) && <label className="input-group">Local passphrase<input ref={passphraseRef} type="password" autoComplete="off" minLength={12} /></label>}
          </>
        )}

        {view === 'modern' && <div className="create-hash-view">
          <label className="input-group">Local passphrase<input ref={passphraseRef} type="password" autoComplete="off" minLength={12} /></label>
          <p className="invite-note">This passphrase unlocks your identity on this device. Keep it private.</p>
          {modernInvite ? <><input className="message-input" readOnly value={modernInvite} aria-label="Modern invitation" /><button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(modernInvite)}>Copy invitation</button><button className="btn btn--primary" type="button" onClick={() => onModernSetupComplete(modernInvite)}>Continue to conversation</button></> : <button className="btn btn--primary" type="button" onClick={handleModernCreate}>Create private contact</button>}
          <button className="btn btn--secondary" type="button" onClick={handleBack}>Back</button>
        </div>}

        {view === 'deleted' && (
          <div className="deleted-state">
            <button className="btn btn--primary" onClick={handleBack}>
              Return home
            </button>
          </div>
        )}

        {status && <div id="setup-status" className="setup-status">{status}</div>}
      </div>
    </div>
  );
};
