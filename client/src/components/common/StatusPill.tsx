import React from 'react';
import './StatusPill.css';

interface StatusPillProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'quiet';
}

export const StatusPill: React.FC<StatusPillProps> = ({ children, tone = 'neutral' }) => (
  <span className={`status-pill status-pill--${tone}`}>{children}</span>
);
