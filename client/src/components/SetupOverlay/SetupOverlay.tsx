import { unlockProgressCopy, type UnlockPhase } from '../../content/copy';
/**
 * Main SetupOverlay component
 */

import { OwnInvitations } from './OwnInvitations';
import { contactsCopy } from '../../content/checkCopy';
import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { parseModernInviteInput } from '../../utils/urlHash';
import { InitialActions } from './InitialActions';
import { JoinHashView } from './JoinHashView';
import { InvitationQr } from './InvitationQr';
import './SetupOverlay.css';
import { EXISTING_PASSPHRASE_REJECTED, setupErrorMessage } from './setupError';

interface SetupOverlayProps {
  isHidden: boolean;
  onModernSetupComplete: () => void;
  onOpenInvitation?: (roomId: string) => void;
}

type ViewType = 'initial' | 'create' | 'join' | 'modern' | 'restore' | 'deleted';

export const SetupOverlay: React.FC<SetupOverlayProps> = ({ onModernSetupComplete, isHidden, onOpenInvitation }) => {
  const { createModernChannel, joinModernChannel, restoreSession, accountState } = useChat();
  const [view, setView] = useState<ViewType>('initial');
  const [joinInput, setJoinInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [unlockPhase, setUnlockPhase] = useState<UnlockPhase>();
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [startupSlow, setStartupSlow] = useState(false);
  const [modernInvite, setModernInvite] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (!isHidden) return;
    setView('initial'); setModernInvite(''); setJoinInput('');
    setStatus(''); setPassphrase(''); setPassphraseConfirmation(''); setDisplayName('');
  }, [isHidden]);

  useEffect(() => {
    if (accountState !== 'checking') { setStartupSlow(false); return; }
    const timer = window.setTimeout(() => setStartupSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [accountState]);
  useEffect(() => {
    if (view === 'join' && !joinInput && parseModernInviteInput(window.location.hash)) {
      setJoinInput(window.location.hash);
    }
  }, [view, joinInput]);

  const handleJoinClick = () => {
    setView('join');
  };

  const handleBack = () => {
    setView('initial');
    setJoinInput('');
    setStatus('');
    setModernInvite('');
    setPassphrase('');
    setPassphraseConfirmation('');
    setShowPassphrase(false);
  };

  const handleJoinNext = async () => {
    const modern = parseModernInviteInput(joinInput);
    if (modern) {
      const localPassphrase = accountState === 'new' ? passphrase : passphraseRef.current?.value ?? '';
      if (accountState === 'checking') return;
      if (accountState === 'locked' && localPassphrase.length < 12) { setStatus(localPassphrase ? EXISTING_PASSPHRASE_REJECTED : 'Enter the passphrase you already use to unlock this device.'); return; }
      if (accountState === 'new' && (!displayName.trim() || localPassphrase.length < 12 || localPassphrase !== passphraseConfirmation)) { setStatus('Choose your display name and confirm a passphrase of at least 12 characters.'); return; }
      if (passphraseRef.current) passphraseRef.current.value = '';
      try {
        setIsLoading(true);
        setStatus('Opening your private contact…');
        await joinModernChannel(modern, localPassphrase, accountState === 'new' ? displayName : undefined);
        onModernSetupComplete();
        setStatus('');
      } catch (error) { setStatus(setupErrorMessage(error, 'join', { existingAccount: accountState === 'locked' || accountState === 'ready' })); }
      finally { setIsLoading(false); }
      return;
    }
    // Legacy room invitations stopped connecting in 6558b5e3 (device proofs); they are no longer offered.
    setStatus('This is an older invitation that no longer works. Ask them to send you a new one.');
  };

  const handleModernCreate = async () => {
    const localPassphrase = passphrase;
    if (accountState !== 'ready' && localPassphrase.length < 12) {
      setStatus('Choose a passphrase with at least 12 characters.');
      return;
    }
    if (accountState === 'new' && (!displayName.trim() || localPassphrase !== passphraseConfirmation)) {
      setStatus('The passphrases do not match yet. Check both entries and try again.');
      return;
    }
    setPassphrase('');
    setPassphraseConfirmation('');
    try {
      setIsLoading(true);
      setStatus('Creating your private contact…');
      const link = await createModernChannel(localPassphrase, accountState === 'new' ? displayName : undefined);
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
      await restoreSession(passphrase, (phase) => setUnlockPhase(phase));
      setStatus('');
      onModernSetupComplete();
    } catch (error) {
      const category = error && typeof error === 'object' && 'restoreFailureCategory' in error
        ? (error as { restoreFailureCategory?: unknown }).restoreFailureCategory : undefined;
      setStatus(category === 'session-record-missing'
        ? 'Your private space opened, but one chat’s saved connection is missing. Don’t clear this browser’s data; your messages are still saved.'
        : 'That passphrase didn’t unlock this device. Try again.');
    }
    finally { setIsLoading(false); setUnlockPhase(undefined); }
  };

  const heading = view === 'initial' ? accountState === 'ready' ? contactsCopy.inviteTitle : 'Private conversations with your people' : view === 'create' ? 'Create an invitation' : view === 'join' ? 'Join someone you trust' : view === 'modern' ? accountState === 'ready' ? 'Add a private contact' : 'Create your account' : view === 'restore' ? 'Welcome back' : 'Conversation closed';
  const description = view === 'initial'
    ? accountState === 'ready' ? 'Share a private invitation with one person. Check it’s really them before sharing files.' : accountState === 'checking' ? 'Preparing your private space on this device.' : (accountState === 'locked' ? 'Unlock with your passphrase to see your chats and contacts on this device.' : 'Create an account on this device, then invite someone you trust. Check it’s really them before sharing files.')
    : view === 'create'
      ? 'Share this invitation with one person you trust.'
      : view === 'join'
      ? 'Paste the private invitation they shared with you. After you connect, check it’s really them before sharing files.'
      : view === 'modern'
          ? accountState === 'ready' ? 'Create an invitation using your unlocked account. Share it privately with one person; it expires for new connections after 24 hours.' : 'Your account and encrypted data are stored on this device. Choose a passphrase you can remember; it is never shared with contacts.'
        : view === 'restore'
            ? 'Enter your passphrase to open your private space on this device.'
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
          </div> : accountState === 'locked' ? <><button className="btn btn--primary" type="button" onClick={() => setView('restore')}>Unlock this device</button><button id="show-join-hash" className="btn btn--secondary" type="button" onClick={handleJoinClick}>{typeof window !== 'undefined' && parseModernInviteInput(window.location.hash) ? 'Unlock and accept invitation' : 'I have an invitation'}</button></> : <InitialActions
            mode={accountState === 'ready' ? 'ready' : 'new'}
            onCreateAccountClick={() => setView('modern')}
            onJoinClick={handleJoinClick}
          />
        )}
        {view === 'initial' && accountState === 'ready' && <OwnInvitations onOpen={onOpenInvitation} />}

        {view === 'join' && (
          <>
            <JoinHashView inviteInput={joinInput} onInviteInputChange={setJoinInput} onBack={handleBack} onJoin={handleJoinNext} isLoading={isLoading} />
            {parseModernInviteInput(joinInput) && accountState === 'ready' && <p>Use your existing unlocked account to accept this invitation.</p>}
            {parseModernInviteInput(joinInput) && accountState === 'new' && <>
              <p>Create your account on this device, then accept this invitation.</p>
              <label className="input-group">Display name<input aria-label="Display name" maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label className="input-group">Choose a passphrase<input aria-label="Choose a passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></label>
              <label className="input-group">Confirm your passphrase<input aria-label="Confirm your passphrase" type="password" value={passphraseConfirmation} onChange={(event) => setPassphraseConfirmation(event.target.value)} autoComplete="new-password" /></label>
            </>}
            {parseModernInviteInput(joinInput) && accountState === 'locked' && <label className="input-group">Your existing passphrase<input ref={passphraseRef} type="password" autoComplete="current-password" minLength={12} aria-describedby="passphrase-help" /><span id="passphrase-help" className="invite-note">At least 12 characters. It unlocks this device’s encrypted data and is not shared with your contact.</span></label>}
          </>
        )}

        {view === 'modern' && <div className="create-hash-view">
          <p className="invite-note">Your account and encrypted data are stored on this device. Use at least 12 characters and keep the passphrase private; you will need it to unlock this device.</p>
          <details className="invite-note"><summary>What is shared?</summary><p>The K3NCRYPT service receives public connection details and carries encrypted messages. Your passphrase is used only on this device and is never sent to contacts.</p></details>
          {accountState === 'new' && <label className="input-group">Display name<input aria-label="Display name" maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
          {accountState !== 'ready' && <><label className="input-group" htmlFor="local-passphrase">Choose a passphrase
            <input id="local-passphrase" ref={passphraseRef} type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" minLength={12} aria-describedby="local-passphrase-help" />
            <span id="local-passphrase-help" className="invite-note">At least 12 characters. It stays on this device and is never sent to contacts.</span>
          </label>
          <button className="btn btn--secondary" type="button" aria-pressed={showPassphrase} onClick={() => setShowPassphrase((shown) => !shown)}>{showPassphrase ? 'Hide passphrase' : 'Show passphrase'}</button></>}
          {accountState === 'new' && <label className="input-group" htmlFor="local-passphrase-confirm">Confirm your passphrase
            <input id="local-passphrase-confirm" type={showPassphrase ? 'text' : 'password'} value={passphraseConfirmation} onChange={(event) => setPassphraseConfirmation(event.target.value)} autoComplete="new-password" minLength={12} />
          </label>}
          {modernInvite ? <><p className="invite-note">Share this invitation only with the person it’s for. It doesn’t show who they are. Check it’s really them before sharing files.</p><InvitationQr invitation={modernInvite} /><input className="message-input" readOnly value={modernInvite} aria-label="Private invitation" /><button className="btn btn--secondary" type="button" onClick={() => void shareInvitation(modernInvite, async () => { await navigator.clipboard.writeText(modernInvite); })}>Share invitation</button><button className="btn btn--secondary" type="button" onClick={() => void navigator.clipboard.writeText(modernInvite).then(() => setStatus('Invitation copied. Share it privately.')).catch(() => setStatus('Clipboard is unavailable. Select and copy the invitation manually.'))}>Copy invitation</button><button className="btn btn--primary" type="button" onClick={() => onModernSetupComplete()}>Continue to your chats</button></> : <button className="btn btn--primary" type="button" disabled={isLoading || (accountState !== 'ready' && passphrase.length < 12) || (accountState === 'new' && (!displayName.trim() || !passphraseConfirmation || passphrase !== passphraseConfirmation))} onClick={handleModernCreate}>{isLoading ? (accountState === 'ready' ? 'Preparing invitation…' : 'Creating your account…') : accountState === 'ready' ? 'Create invitation' : 'Create secure account'}</button>}
          <button className="btn btn--secondary" type="button" onClick={handleBack}>Back</button>
        </div>}

        {view === 'restore' && <div className="create-hash-view">
          <label className="input-group">Passphrase<input ref={passphraseRef} type="password" autoComplete="current-password" minLength={12} /></label>
          <p className="invite-note">Your passphrase unlocks the encrypted data on this device. It is never shared with your contacts.</p>
          {isLoading && unlockPhase && (() => { const progress = unlockProgressCopy(unlockPhase);
            return <div className="unlock-progress" role="status" aria-live="polite"><span>{progress.label}</span><progress max={progress.of} value={progress.step} aria-label={`Step ${progress.step} of ${progress.of}`} /></div>; })()}
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
