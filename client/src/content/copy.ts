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
    description: 'Your messages will appear here when you send or receive them.',
  },
} as const;
