import React from 'react';

export type ApprovedIconName = 'logo' | 'chat' | 'contacts' | 'call' | 'settings' | 'shield' | 'send' | 'video' | 'mic' | 'securechat';

const iconFiles: Record<ApprovedIconName, string> = {
  logo: 'logo.svg', chat: 'chat.svg', contacts: 'contacts.svg', call: 'call.svg', settings: 'settings.svg',
  shield: 'shield.svg', send: 'send.svg', video: 'video.svg', mic: 'mic.svg', securechat: 'securechat.svg',
};

/** Static design asset map; names cannot be influenced by user content. */
export const ApprovedIcon: React.FC<{ name: ApprovedIconName; size?: number; title?: string }> = ({ name, size = 18, title }) => (
  <span
    aria-hidden={title ? undefined : true}
    aria-label={title}
    role={title ? 'img' : undefined}
    className="approved-icon"
    style={{ width: size, height: size, maskImage: `url(/icons/${iconFiles[name]})`, WebkitMaskImage: `url(/icons/${iconFiles[name]})` }}
  />
);
