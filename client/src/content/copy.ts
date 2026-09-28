export const copy = {
  welcome: {
    title: 'K3ncrypt',
    tagline: 'Private messages and calls with people you trust.',
    primary: 'Get started',
    restore: 'Restore identity',
  },
  contact: {
    title: 'Bring someone in',
    description: 'Share an invitation, compare security details, then start a private conversation.',
  },
  verification: {
    title: 'Confirm connection',
    description: 'A contact is not trusted until you compare fingerprints through another trusted channel and confirm verification. Display names and nicknames help you recognize people; they do not prove identity.',
  },
  contactsEmpty: {
    title: 'No trusted contacts yet',
    description: 'Create or join an invitation to start a secure conversation. A contact becomes trusted only after you compare fingerprints and confirm verification.',
  },
  conversationEmpty: {
    title: 'Start your conversation',
    description: 'Messages are end-to-end encrypted and saved on this device. Your conversation starts when you send or receive a message.',
  },
} as const;

const genericContactLabels = new Set(['private contact', 'trusted contact', 'new contact', 'private conversation', 'conversation']);

export const contactDisplayName = (label?: string | null): string => {
  const trimmed = label?.trim();
  return !trimmed || genericContactLabels.has(trimmed.toLocaleLowerCase()) ? 'Contact' : trimmed;
};
