export const copy = {
  welcome: {
    title: 'K3ncrypt',
    tagline: 'Private messages and calls with people you trust.',
    primary: 'Get started',
    restore: 'Restore identity',
  },
  contact: {
    title: 'Bring someone in',
    description: 'Share an invitation, compare security codes, then start a private conversation.',
  },
  verification: {
    title: 'Confirm connection',
    description: 'A contact is not trusted until you compare security codes with them using another trusted way and confirm. Names help you recognize people; they do not prove who someone is.',
  },
  contactsEmpty: {
    title: 'No trusted contacts yet',
    description: 'Create or join an invitation to start a private conversation. A contact becomes trusted only after you compare security codes and confirm.',
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
