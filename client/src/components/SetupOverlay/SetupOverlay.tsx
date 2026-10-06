/**
 * Main SetupOverlay component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { parseInviteInput, parseModernInviteInput } from '../../utils/urlHash';
import { InitialActions } from './InitialActions';
import { CreateHashView } from './CreateHashView';
import { JoinHashView } from './JoinHashView';
import { InvitationQr } from './InvitationQr';
import './SetupOverlay.css';
import { debugError } from '../../utils/debug';

interface SetupOverlayProps {
  onSetupComplete: (roomId: string, secret: string, controlCapability: string) => Promise<void>;
  isHidden: boolean;
  onModernSetupComplete: () => void;
}

type ViewType = 'initial' | 'create' | 'join' | 'modern' | 'restore' | 'deleted';

const setupErrorMessage = (error: unknown, action: 'invitation' | 'contact'): string => {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 503) return 'K3NCRYPT is starting or its secure storage is unavailable. Wait a moment, then retry.';
  if (status === 404 || status === 502 || status === 504) return 'The K3NCRYPT backend is unavailable or is not the expected service. Check the server address, then retry.';
  if (error instanceof TypeError) return 'Could not reach the K3NCRYPT backend. Check your connection, then retry.';
  return action === 'invitation'
    ? 'Could not create an invitation. Retry after checking the K3NCRYPT backend.'
    : 'Could not create this contact. Use a passphrase of at least 12 characters, then retry.';
};

export const SetupOverlay: React.FC<SetupOverlayProps> = ({ onSetupComplete, onModernSetupComplete, isHidden }) => {
  const { createNewChannel, createModernChannel, joinModernChannel, restoreSession, accountState } = useChat();
  const [view, setView] = useState<ViewType>('initial');
  const [invite, setInvite] = useState<{ roomId: string; secret: string; controlCapability: string; link: string } | null>(null);
  const [joinInput, setJoinInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [startupSlow, setStartupSlow] = useState(false);
  const [modernInvite, setModernInvite] = useState('');

  useEffect(() => {
    if (accountState !== 'checking') { setStartupSlow(false); return; }
    const timer = window.setTimeout(() => setStartupSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [accountState]);
  // Generate the invitation (room id from the server + a locally generated secret) when entering create view
  const generateInvite = useCallback(async () => {
    try {
      setIsLoading(true);
      setStatus('Generating a secure invitation...');
      const created = await createNewChannel();
      setInvite({ roomId: created.roomId, secret: created.secret, controlCapability: created.controlCapability, link: created.absoluteLink || created.link });
      setStatus('');
    } catch (err) {
      setStatus(setupErrorMessage(err, 'invitation'));
      debugError('Invitation generation failed', err);
    } finally {
      setIsLoading(false);
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
    setPassphrase('');
    setPassphraseConfirmation('');
    setShowPassphrase(false);
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
        setIsLoading(true);
        setStatus('Opening your private contact…');
        await joinModernChannel(modern.roomId, modern.controlCapability, modern.address, modern.identityCommitment, passphrase);
        onModernSetupComplete();
        setStatus('');
      } catch { setStatus('Could not open this contact. Check the invitation and local passphrase.'); }
      finally { setIsLoading(false); }
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
    const localPassphrase = passphrase;
    if (localPassphrase.length < 12) {
      setStatus('Choose a passphrase with at least 12 characters.');
      return;
    }
    if (accountState === 'new' && localPassphrase !== passphraseConfirmation) {
      setStatus('The passphrases do not match yet. Check both entries and try again.');
      return;
    }
    setPassphrase('');
    setPassphraseConfirmation('');
    try {
      setIsLoading(true);
      setStatus('Creating your private contact…');
      const link = await createModernChannel(localPassphrase);
      setModernInvite(link);
      setStatus('Share this invitation with one person you trust.');
    } catch (error) { setStatus(setupErrorMessage(error, 'contact')); }
    finally { setIsLoading(false); }
  };

  const handleRestore = async () => {
    const passphrase = passphraseRef.current?.value ?? '';
    if (passphraseRef.current) passphraseRef.current.value = '';
    try {
      setIsLoading(true);
      setStatus('Unlocking your encrypted account…');
      await restoreSession(passphrase);
      setStatus('');
      onModernSetupComplete();
    } catch (error) {
      const category = error && typeof error === 'object' && 'restoreFailureCategory' in error
        ? (error as { restoreFailureCategory?: unknown }).restoreFailureCategory : undefined;
      setStatus(category === 'session-record-missing'
        ? 'The vault unlocked, but this conversation’s saved encrypted session is missing. Keep this device’s data intact while you check for an encrypted backup.'
        : 'Could not unlock this account. Check the local passphrase and try again.');
    }
    finally { setIsLoading(false); }
  };

  const heading = view === 'initial' ? accountState === 'ready' ? 'Add someone you trust' : 'Private conversations with your people' : view === 'create' ? 'Create an invitation' : view === 'join' ? 'Join someone you trust' : view === 'modern' ? accountState === 'ready' ? 'Add a private contact' : 'Create your account' : view === 'restore' ? 'Welcome back' : 'Conversation closed';
  const description = view === 'initial'
    ? accountState === 'ready' ? 'Share a private invitation with one person. Compare the security code with them before marking the contact verified.' : accountState === 'checking' ? 'Preparing your private space on this device.' : 'Create an account on this device, then invite someone you trust. Compare security codes before you mark a contact verified.'
    : view === 'create'
      ? 'Share this invitation with one person you trust.'
      : view === 'join'
      ? 'Paste the private invitation they shared with you. You’ll compare identities before the conversation is trusted.'
      : view === 'modern'
          ? accountState === 'ready' ? 'Enter your local passphrase to create a private invitation. Your passphrase stays on this device and is never shared with your contact.' : 'Your account and encrypted data are stored on this device. Choose a passphrase you can remember; it is never shared with contacts.'
        : view === 'restore'
            ? 'Enter the local passphrase to unlock this device’s encrypted vault and restore its identity and saved conversations.'
        : 'This invitation is no longer available.';

  const shareInvitation = async (link: string, fallback: () => Promise<void>) => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'K3NCRYPT invitation', text: 'Join me for a private conversation on K3NCRYPT.', url: link });
        return;
      }
      await fallback();
      setStatus('Invitation copied. Share it privately with the person you want to contact.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        await fallback();
        setStatus('Invitation copied. Share it privately with the person you want to contact.');
      } catch {
        setStatus('Could not share the invitation. Check browser sharing or clipboard access, then retry.');
      }
    }
  };

  return (
    <div className={`overlay ${isHidden ? 'hidden' : ''}`}>
      <div className="overlay-content">
        <img className="welcome-wordmark" src="/branding/k3ncrypt-appicon.svg" alt="K3NCRYPT" />
        <span className="welcome-kicker">A place for your people</span>
        <h1>{heading}</h1>
        <p>{description}</p>

        {view === 'initial' && (
          accountState === 'checking' ? <div className="setup-status" role="status" aria-live="polite">
            <span>Connecting to K3NCRYPT…</span>
            {startupSlow && <span>This is taking longer than usual. The service may be starting; keep this page open.</span>}
          </div> : accountState === 'locked' ? <button className="btn btn--primary" type="button" onClick={() => setView('restore')}>Unlock this device</button> : <InitialActions
            mode={accountState === 'ready' ? 'ready' : 'new'}
            onCreateAccountClick={() => setView('modern')}
            onCreateClick={handleCreateClick}
            onJoinClick={handleJoinClick}
          />
        )}

        {view === 'create' && (
          <CreateHashView
            inviteLink={invite?.link || ''}
            onCopyClick={handleCopyHash}
            onShareClick={() => invite && void shareInvitation(invite.link, async () => { await navigator.clipboard.writeText(invite.link); })}
            isLoading={isLoading}
            onBack={handleBack}
            onNext={handleCreateNext}
            onRetry={generateInvite}
          />
        )}

        {view === 'join' && (
          <>
            <JoinHashView inviteInput={joinInput} onInviteInputChange={setJoinInput} onBack={handleBack} onJoin={handleJoinNext} isLoading={isLoading} />
            {parseModernInviteInput(joinInput) && <label className="input-group">Local passphrase<input ref={passphraseRef} type="password" autoComplete="current-password" minLength={12} aria-describedby="passphrase-help" /><span id="passphrase-help" className="invite-note">At least 12 characters. It unlocks this device’s encrypted data and is not shared with your contact.</span></label>}
          </>
        )}

        {view === 'modern' && <div className="create-hash-view">
          <p className="invite-note">Your account and encrypted data are stored on this device. Use at least 12 characters and keep the passphrase private; you will need it to unlock this device.</p>
          <details className="invite-note"><summary>What is shared?</summary><p>The K3NCRYPT service receives public connection details and carries encrypted messages. Your passphrase is used only on this device and is never sent to contacts.</p></details>
          <label className="input-group" htmlFor="local-passphrase">{accountState === 'ready' ? 'Confirm your local passphrase' : 'Choose a passphrase'}
            <input id="local-passphrase" ref={passphraseRef} type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete={accountState === 'ready' ? 'current-password' : 'new-password'} minLength={12} aria-describedby="local-passphrase-help" />
            <span id="local-passphrase-help" className="invite-note">At least 12 characters. It stays on this device and is never sent to contacts.</span>
          </label>
          <button className="btn btn--secondary" type="button" aria-pressed={showPassphrase} onClick={() => setShowPassphrase((shown) => !shown)}>{showPassphrase ? 'Hide passphrase' : 'Show passphrase'}</button>
          {accountState === 'new' && <label className="input-group" htmlFor="local-passphrase-confirm">Confirm your passphrase
            <input id="local-passphrase-confirm" type={showPassphrase ? 'text' : 'password'} value={passphraseConfirmation} onChange={(event) => setPassphraseConfirmation(event.target.value)} autoComplete="new-password" minLength={12} />
          </label>}
          {modernInvite ? <><p className="invite-note">Share this invitation only with the intended person. It does not verify who they are. Compare security codes with them before marking the contact verified.</p><InvitationQr invitation={modernInvite} /><input className="message-input" readOnly value={modernInvite} aria-label="Private invitation" /><button className="btn btn--secondary" type="button" onClick={() => void shareInvitation(modernInvite, async () => { await navigator.clipboard.writeText(modernInvite); })}>Share invitation</button><button className="btn btn--secondary" type="button" onClick={() => void navigator.clipboard.writeText(modernInvite).then(() => setStatus('Invitation copied. Share it privately.')).catch(() => setStatus('Clipboard is unavailable. Select and copy the invitation manually.'))}>Copy invitation</button><button className="btn btn--primary" type="button" onClick={() => onModernSetupComplete()}>Continue to your chats</button></> : <button className="btn btn--primary" type="button" disabled={isLoading || passphrase.length < 12 || (accountState === 'new' && (!passphraseConfirmation || passphrase !== passphraseConfirmation))} onClick={handleModernCreate}>{isLoading ? (accountState === 'ready' ? 'Preparing invitation…' : 'Creating your account…') : accountState === 'ready' ? 'Create invitation' : 'Create secure account'}</button>}
          <button className="btn btn--secondary" type="button" onClick={handleBack}>Back</button>
        </div>}

        {view === 'restore' && <div className="create-hash-view">
          <label className="input-group">Local passphrase<input ref={passphraseRef} type="password" autoComplete="current-password" minLength={12} /></label>
          <p className="invite-note">Your passphrase unlocks the encrypted vault on this device. It is never your contact’s identity or verification.</p>
          <button className="btn btn--primary" type="button" disabled={isLoading} onClick={handleRestore}>{isLoading ? 'Unlocking…' : 'Unlock account'}</button>
          <button className="btn btn--secondary" type="button" onClick={handleBack}>Back</button>
        </div>}

        {view === 'deleted' && (
          <div className="deleted-state">
            <button className="btn btn--primary" onClick={handleBack}>
              Return home
            </button>
          </div>
        )}

        {status && <div id="setup-status" className="setup-status" role="status" aria-live="polite">{status}</div>}
      </div>
    </div>
  );
};
