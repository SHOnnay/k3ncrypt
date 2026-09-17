/**
 * Main SetupOverlay component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useChat } from '../../context/ChatContext';
import { parseInviteInput } from '../../utils/urlHash';
import { InitialActions } from './InitialActions';
import { CreateHashView } from './CreateHashView';
import { JoinHashView } from './JoinHashView';
import './SetupOverlay.css';
import { ShieldIcon } from '../common/icons';
import { debugError } from '../../utils/debug';

interface SetupOverlayProps {
  onSetupComplete: (roomId: string, secret: string) => Promise<void>;
  isHidden: boolean;
}

type ViewType = 'initial' | 'create' | 'join' | 'deleted';

export const SetupOverlay: React.FC<SetupOverlayProps> = ({ onSetupComplete, isHidden }) => {
  const { createNewChannel } = useChat();
  const [view, setView] = useState<ViewType>('initial');
  const [invite, setInvite] = useState<{ roomId: string; secret: string; link: string } | null>(null);
  const [joinInput, setJoinInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [, setIsLoading] = useState<boolean>(false);

  // Generate the invitation (room id from the server + a locally generated secret) when entering create view
  const generateInvite = useCallback(async () => {
    try {
      setStatus('Generating a secure invitation...');
      const created = await createNewChannel();
      setInvite({ roomId: created.roomId, secret: created.secret, link: created.absoluteLink || created.link });
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
      await onSetupComplete(invite.roomId, invite.secret);
    } catch (err) {
      setStatus('Failed to connect. Please try again.');
      debugError('Conversation setup failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinNext = async () => {
    const parsed = parseInviteInput(joinInput);
    if (!parsed) {
      setStatus('Please enter a valid invitation link.');
      return;
    }
    try {
      setIsLoading(true);
      setStatus('Connecting...');
      await onSetupComplete(parsed.roomId, parsed.secret);
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

  return (
    <div className={`overlay ${isHidden ? 'hidden' : ''}`}>
      <div className="overlay-content">
        <div className="welcome-icon" aria-hidden="true"><ShieldIcon size={25} /></div>
        <span className="welcome-kicker">Private by design</span>
        <h1>Welcome to K3ncrypt</h1>
        <p>Start an encrypted conversation or use an invitation from someone you trust.</p>

        {view === 'initial' && (
          <InitialActions
            onCreateClick={handleCreateClick}
            onJoinClick={handleJoinClick}
          />
        )}

        {view === 'create' && (
          <CreateHashView
            inviteLink={invite?.link || ''}
            onCopyClick={handleCopyHash}
            onBack={handleBack}
            onNext={handleCreateNext}
          />
        )}

        {view === 'join' && (
          <JoinHashView
            inviteInput={joinInput}
            onInviteInputChange={setJoinInput}
            onBack={handleBack}
            onJoin={handleJoinNext}
          />
        )}

        {view === 'deleted' && (
          <div className="deleted-state">
            <h2>Conversation deleted</h2>
            <p>This invitation is no longer available.</p>
            <button className="btn btn--primary" onClick={handleBack}>
              Return Home
            </button>
          </div>
        )}

        {status && <div id="setup-status" className="setup-status">{status}</div>}
      </div>
    </div>
  );
};
