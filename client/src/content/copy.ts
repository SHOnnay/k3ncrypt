export const copy = {
  welcome: {
    title: 'K3ncrypt',
    tagline: 'Private messages and calls with people you trust.',
    primary: 'Get started',
    restore: 'Restore identity',
  },
  contact: {
    title: 'Bring someone in',
    description: 'Share an invitation, check it’s really them, then start a private conversation.',
  },
  verification: {
    title: 'Confirm connection',
    description: 'Anyone can copy a name. Check it’s really them before sharing photos and files.',
  },
  contactsEmpty: {
    title: 'No contacts yet.',
    description: 'Invite someone to start.',
  },
  conversationEmpty: {
    title: 'Start your conversation',
    description: 'Messages are end-to-end encrypted and saved on this device. Your conversation starts when you send or receive a message.',
  },
} as const;

const genericContactLabels = new Set(['contact', 'private contact', 'trusted contact', 'new contact', 'private conversation', 'conversation']);

export const contactDisplayName = (label?: string | null, roomId?: string, remoteDisplayName?: string, localNickname?: string): string => {
  if (localNickname?.trim()) return localNickname.trim();
  const trimmed = label?.trim();
  if (trimmed && !genericContactLabels.has(trimmed.toLocaleLowerCase())) return trimmed;
  if (remoteDisplayName?.trim()) return remoteDisplayName.trim();
  const shortId = roomId?.replace(/[^a-z0-9]/gi, '').slice(-4).toLocaleUpperCase();
  return shortId ? `Contact · ${shortId}` : 'Contact';
};
