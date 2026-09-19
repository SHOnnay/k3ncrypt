import React from 'react';
import { ChevronRightIcon } from '../common/icons';
import { StatusPill } from '../common/StatusPill';

interface SettingsRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  status?: string;
  disabled?: boolean;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({ icon, title, description, onClick, status, disabled = false }) => {
  const content = (
    <>
      <span className="settings-row__icon" aria-hidden="true">{icon}</span>
      <span className="settings-row__copy"><strong>{title}</strong><small>{description}</small></span>
      {status ? <StatusPill tone={disabled ? 'quiet' : 'neutral'}>{status}</StatusPill> : onClick ? <ChevronRightIcon size={17} /> : null}
    </>
  );

  return onClick && !disabled ? (
    <button className="settings-row" type="button" onClick={onClick}>{content}</button>
  ) : (
    <div className={`settings-row ${disabled ? 'settings-row--disabled' : ''}`}>{content}</div>
  );
};
