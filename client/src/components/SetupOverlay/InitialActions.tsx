/**
 * Initial actions for setup overlay
 */

import React from 'react';
import { Button } from '../common/Button';
import { copy } from '../../content/copy';
import './InitialActions.css';

interface InitialActionsProps {
  onCreateClick: () => void;
  onJoinClick: () => void;
}

export const InitialActions: React.FC<InitialActionsProps> = ({ onCreateClick, onJoinClick }) => {
  return (
    <div id="initial-actions" className="initial-actions">
      <Button id="show-create-hash" variant="primary" size="large" onClick={onCreateClick}>
        {copy.welcome.primary}
      </Button>
      
      <Button id="show-join-hash" variant="secondary" size="large" onClick={onJoinClick}>
        Use an invitation
      </Button>
      <button className="restore-identity" type="button" disabled title="Persistent identities are planned for a later phase">
        {copy.welcome.restore} <span>Not available yet</span>
      </button>
    </div>
  );
};
