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
import './CreateHashView.css';

interface CreateHashViewProps {
  inviteLink: string;
  onCopyClick: () => void;
  onBack: () => void;
  onNext: () => void;
  onRetry?: () => void;
}

export const CreateHashView: React.FC<CreateHashViewProps> = ({
  inviteLink,
  onCopyClick,
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

      <p className="invite-note">Anyone with this invitation can enter this space. Share it privately.</p>

      <div className="button-group">
        <Button id="back-btn" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button id="join-btn" variant="primary" onClick={onNext} disabled={!inviteLink}>
          Continue to conversation
        </Button>
        {!inviteLink && onRetry && <Button id="retry-invitation-btn" variant="primary" onClick={onRetry}>
          Retry invitation
        </Button>}
      </div>
    </div>
  );
};
