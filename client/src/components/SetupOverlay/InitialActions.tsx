/**
 * Initial actions for setup overlay
 */

import React from 'react';
import { Button } from '../common/Button';
import './InitialActions.css';

interface InitialActionsProps {
  onCreateClick: () => void;
  onJoinClick: () => void;
}

export const InitialActions: React.FC<InitialActionsProps> = ({ onCreateClick, onJoinClick }) => {
  return (
    <div id="initial-actions" className="initial-actions">
      <Button id="show-create-hash" variant="primary" size="large" onClick={onCreateClick}>
        Start a private conversation
      </Button>
      
      <Button id="show-join-hash" variant="secondary" size="large" onClick={onJoinClick}>
        Join with an invite
      </Button>
      <button className="restore-identity" type="button" disabled title="Persistent identities are planned for a later phase">
        Restore an identity <span>Coming later</span>
      </button>
    </div>
  );
};
