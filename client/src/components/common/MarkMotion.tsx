import React from 'react';
import './MarkMotion.css';

/** "Mark in motion": three dots settle in once, then a slow pulse. Static under reduced motion. Keep in step with startup.css. */
export const MarkMotion: React.FC<{ size?: number; label?: string }> = ({ size = 74, label }) => (
  <svg className="mark-motion" viewBox="0 0 100 100" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <path className="mark-motion__curve" d="M38 62 Q54 46 66 40" />
    <path className="mark-motion__curve mark-motion__curve--late" d="M66 40 Q72 56 70 70" />
    <circle className="mark-motion__dot mark-motion__dot--a" cx="38" cy="62" r="17" />
    <circle className="mark-motion__dot mark-motion__dot--b" cx="66" cy="40" r="11.5" />
    <circle className="mark-motion__dot mark-motion__dot--c" cx="70" cy="70" r="8.5" />
  </svg>
);
