/**
 * Plain-language copy for checking a contact (M1c, Option B). One word everywhere: "check".
 * The code is the "security number". Presentation only: nothing here grants trust.
 */
export type CheckState = 'unchecked' | 'checked' | 'changed' | 'unavailable';

interface ContactLike { verification?: string; changeStatus?: string; identityId?: string }

export const checkState = (contact: ContactLike | undefined): CheckState => {
  if (contact?.changeStatus === 'changed-pending-review') return 'changed';
  if (!contact?.identityId && !contact?.verification) return 'unavailable';
  if (contact.verification === 'verified' && contact.changeStatus === 'unchanged') return 'checked';
  return 'unchecked';
};

export const CHECK_PILL: Record<CheckState, string> = {
  unchecked: 'Not checked yet',
  checked: 'Checked on this device',
  changed: 'Security number changed',
  unavailable: 'Not available yet',
};

/** Generic room labels ("Contact", "Contact · 00DB") read as "your contact" in sentences. */
export const checkName = (label: string | undefined): string =>
  !label || /^Contact(?: · [A-Z0-9]+)?$/.test(label.trim()) ? 'your contact' : label.trim();
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const checkCopy = {
  title: (name: string) => `Check it’s really ${name}`,
  banner: (name: string) => `Before sharing photos and files, check it’s really ${name}. It takes a minute.`,
  checkNow: 'Check now',
  checkAgain: 'Check again',
  askBack: (name: string) => `Ask ${name} to check you too.`,
  checked: (name: string) => `${cap(name)} is checked on this device.`,
  androidQuestion: (name: string) => `Is ${name} using K3NCRYPT on an Android phone?`,
  togetherQuestion: (name: string) => `Are you with ${name} right now?`,
  scanTitle: (name: string) => `Scan ${name}’s code`,
  scanHelp: (name: string) => `Ask ${name} to open your chat in K3NCRYPT, tap Check, then More options → Show my code.`,
  scanMatched: (name: string) => `That’s ${name}’s code. Tap Confirm to mark ${name} as checked.`,
  scanWrong: (name: string) => `This isn’t ${name}’s code. Don’t confirm. Make sure you’re scanning ${name}’s own phone.`,
  showNumbersInstead: 'Show numbers instead',
  readEachCharacter: 'Read each group, one character at a time. Capital letters matter. Where a group has a dash (-) or underscore (_), the spelling is shown under it.',
  showMyCodeTitle: (name: string) => `Now let ${name} scan your code.`,
  callFirst: (name: string) => `Call ${name} on a number you already know. Don’t use a number sent in this chat.`,
  numbersHelp: (name: string) => `You and ${name} see the same security number. Read it to each other. Only tap “They match” if every group is the same.`,
  numbersMismatch: 'Don’t tap “They match”. Try again on a call you trust. If the numbers still differ, someone may be in between you. Don’t send anything private.',
  androidTitle: (name: string) => `${cap(name)}’s Android phone checks you by your full security number`,
  androidHelp: (name: string) => `Read your security number to ${name}. ${cap(name)} types it into K3NCRYPT on their phone to check you.`,
  androidLimit: (name: string) => `Checking ${name} from this side needs an update to the Android app. Until then, ${cap(name)} shows as Not checked yet here, and files from ${name} won’t open on this device.`,
  changed: (name: string) => `${cap(name)}’s security number changed. This happens if ${name} reinstalled K3NCRYPT or got a new phone. It can also mean someone is trying to listen in. Files and calls are paused until you check again.`,
  fileBlocked: (name: string) => `Check it’s really ${name} to open this file.`,
  fileBlockedChanged: (name: string) => `${cap(name)}’s security number changed. Check again to open this file.`,
};

export const connectionCopy = {
  connected: 'Connected',
  connecting: 'Connecting…',
  connectingHelp: 'Messages will send when connected.',
  offline: 'You’re offline.',
  offlineHelp: 'Messages will send when you’re back.',
};

export const serverCopy = {
  title: 'K3NCRYPT server',
  reachable: 'Reachable',
  checking: 'Checking…',
  notReachable: 'Not reachable',
};

export const contactsCopy = {
  checkedGroup: 'Checked',
  uncheckedGroup: 'Not checked yet',
  emptyTitle: 'No contacts yet.',
  chatsEmptyTitle: 'No chats yet.',
  lockedTitle: 'Unlock to see your chats',
  lockedHelp: 'Your chats and contacts stay encrypted on this device until you unlock.',
  emptyHelp: 'Invite someone to start.',
  inviteTitle: 'Invite someone',
  yourInvitations: 'Your invitations',
  yourInvitationLabel: 'Your invitation',
  yourInvitationHelp: 'Waiting for someone to accept. It is not a contact yet.',
};
