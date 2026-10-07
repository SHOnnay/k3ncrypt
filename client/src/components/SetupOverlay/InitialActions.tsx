/**
 * Initial actions for setup overlay
 */

import React from 'react';
import { Button } from '../common/Button';
import './InitialActions.css';

interface InitialActionsProps {
  onCreateAccountClick: () => void;
  onCreateClick: () => void;
  onJoinClick: () => void;
  mode?: 'new' | 'ready';
  disabled?: boolean;
}

export const InitialActions: React.FC<InitialActionsProps> = ({ onCreateAccountClick, onCreateClick, onJoinClick, mode = 'new', disabled = false }) => {
  return (
    <div id="initial-actions" className="initial-actions">
      <Button id="show-create-account" variant="primary" size="large" onClick={onCreateAccountClick} disabled={disabled}>
        {mode === 'new' ? 'Create your private account' : 'Invite someone'}
      </Button>
      <Button id="show-join-hash" variant="secondary" size="large" onClick={onJoinClick} disabled={disabled}>
        I have an invitation
      </Button>
      <details className="legacy-invite-option">
        <summary>Using an older K3NCRYPT invitation?</summary>
        <Button id="show-create-hash" variant="secondary" size="medium" onClick={onCreateClick} disabled={disabled}>
          Create a room invitation
        </Button>
      </details>
    </div>
  );
};
