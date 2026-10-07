/**
 * Join-by-invite view component.
 *
 * Accepts a full invitation fragment with independent message and control
 * secrets rather than a bare room id. The message secret never reaches the
 * relay; the control bearer authorizes membership.
 */

import React, { useEffect } from 'react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { useUrlHash } from '../../hooks/useUrlHash';
import { InvitationQrScanner } from './InvitationQr';
import './JoinHashView.css';

interface JoinHashViewProps {
  inviteInput: string;
  onInviteInputChange: (value: string) => void;
  onBack: () => void;
  onJoin: () => void;
  isLoading?: boolean;
}

export const JoinHashView: React.FC<JoinHashViewProps> = ({
  inviteInput,
  onInviteInputChange,
  onBack,
  onJoin,
  isLoading = false,
}) => {
  const { invite } = useUrlHash();

  // Auto-populate from the URL invite fragment if available
  useEffect(() => {
    if (invite && !inviteInput) {
      onInviteInputChange(`room=${invite.roomId}&secret=${invite.secret}&control=${invite.controlCapability}`);
    }
  }, [invite, inviteInput, onInviteInputChange]);

  return (
    <div className="join-hash-view">
      <Input
        id="channel-hash"
        label="Invitation"
        placeholder="Paste the invitation here"
        value={inviteInput}
        onChange={onInviteInputChange}
      />
      <p className="invite-note">An invitation does not verify who sent it. Compare security codes with your contact using another trusted way, then confirm before trusting them.</p>
      <InvitationQrScanner onScanned={onInviteInputChange} />

      <div className="button-group">
        <Button id="back-btn" variant="secondary" onClick={onBack} disabled={isLoading}>
          Back
        </Button>
        <Button id="join-btn" variant="primary" onClick={onJoin} disabled={!inviteInput.trim() || isLoading}>
          {isLoading && <span className="three-node-wait" aria-hidden="true"><i /><i /><i /></span>}
          {isLoading ? 'Opening conversation…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
};
