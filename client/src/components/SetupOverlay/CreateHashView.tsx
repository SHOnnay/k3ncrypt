/**
 * Create-invite view component.
 *
 * Displays the shareable invitation link
 * (`#room=<public-room-id>&secret=<secret>&control=<capability>`). Both
 * values are generated on this device and carried in the URL fragment; only
 * the control bearer is presented to the relay for authorization.
 */

import React, { useState } from 'react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { CopyIcon } from '../common/icons';
import { InvitationQr } from './InvitationQr';
import './CreateHashView.css';

interface CreateHashViewProps {
  inviteLink: string;
  onCopyClick: () => void;
  onShareClick?: () => void;
  isLoading?: boolean;
  onBack: () => void;
  onNext: () => void;
  onRetry?: () => void;
}

export const CreateHashView: React.FC<CreateHashViewProps> = ({
  inviteLink,
  onCopyClick,
  onShareClick,
  isLoading = false,
  onBack,
  onNext,
  onRetry,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopyClick();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="create-hash-view">
      <div className="input-group">
        <label>Private invitation</label>
        <div className="copy-input">
          <Input
            id="generated-hash-display"
            value={inviteLink}
            onChange={() => { }}
            placeholder="Generating..."
            readOnly
          />
          <Button
            variant="secondary"
            size="small"
            onClick={handleCopy}
            title="Copy Invitation Link"
          >
            <CopyIcon size={20} />
          </Button>
        </div>
        {copied && <span className="copy-feedback">Invitation copied</span>}
      </div>

      <p className="invite-note">This invitation opens a private conversation. Share it only with the person you intend to contact.</p>
      {inviteLink && <InvitationQr invitation={inviteLink} />}

      {onShareClick && inviteLink && <Button variant="secondary" size="medium" onClick={onShareClick}>
        Share invitation
      </Button>}

      <div className="button-group">
        <Button id="back-btn" variant="secondary" onClick={onBack} disabled={isLoading}>
          Back
        </Button>
        <Button id="join-btn" variant="primary" onClick={onNext} disabled={!inviteLink || isLoading}>
          {isLoading ? 'Preparing your conversation…' : 'Continue'}
        </Button>
        {!inviteLink && onRetry && <Button id="retry-invitation-btn" variant="primary" onClick={onRetry}>
          Retry invitation
        </Button>}
      </div>
    </div>
  );
};
