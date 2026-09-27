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
}

export const InitialActions: React.FC<InitialActionsProps> = ({ onCreateAccountClick, onCreateClick, onJoinClick }) => {
  return (
    <div id="initial-actions" className="initial-actions">
      <Button id="show-create-account" variant="primary" size="large" onClick={onCreateAccountClick}>
        Create your private account
      </Button>
      <Button id="show-join-hash" variant="secondary" size="large" onClick={onJoinClick}>
        I have an invitation
      </Button>
      <details className="legacy-invite-option">
        <summary>Using an older K3NCRYPT invitation?</summary>
        <Button id="show-create-hash" variant="secondary" size="medium" onClick={onCreateClick}>
          Create a room invitation
        </Button>
      </details>
    </div>
  );
};
