import type { StoredContactIdentity } from '@chat-e2ee/service';

/** Presentation only. Never authorizes sending, verification, or device actions. */
export const verificationPresentation = (contact: StoredContactIdentity | undefined, availability: 'waiting' | 'unavailable' = 'waiting') => {
  if (contact?.changeStatus === 'changed-pending-review') return { state: 'changed', title: 'Security number changed', description: 'Files and calls are paused until you check again.' };
  if (!contact?.identityId) return availability === 'unavailable'
    ? { state: 'unavailable', title: 'Not available right now', description: 'Unlock this device and open the conversation again. Your history and checks are kept.' }
    : { state: 'waiting', title: 'Waiting for them to accept', description: 'You can check this person after they accept your invitation.' };
  if (contact.verification === 'verified' && contact.changeStatus === 'unchanged') return { state: 'verified', title: 'Checked on this device', description: 'You checked their security number on this device.' };
  return { state: 'unverified', title: 'Not checked yet', description: 'Check their security number in person or on a call you trust.' };
};
export const permissionLabel = (state: PermissionState | 'unknown' | 'unsupported' | 'default') => ({ granted: 'Allowed', denied: 'Blocked', prompt: 'Ask when needed', default: 'Not granted', unknown: 'Not reported', unsupported: 'Unavailable' })[state];
export const deviceStateLabel = (state: string): string => ({ active: 'Active', revoked: 'Revoked', pending_enrollment: 'Awaiting approval', approved_pending_confirmation: 'Approved · confirmation needed' })[state] ?? 'Status unavailable';
