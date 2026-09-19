import React from 'react';
import './Avatar.css';

interface AvatarProps {
  label: string;
  size?: 'small' | 'medium' | 'large' | 'hero';
  status?: 'online' | 'offline';
}

export const Avatar: React.FC<AvatarProps> = ({ label, size = 'medium', status }) => (
  <span className={`avatar avatar--${size}`} aria-hidden="true">
    <span>{label.slice(0, 1).toUpperCase()}</span>
    {status && <i className={`avatar__status avatar__status--${status}`} />}
  </span>
);
