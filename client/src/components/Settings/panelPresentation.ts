import type { StoredContactIdentity } from '@chat-e2ee/service';

/** Presentation only. Never authorizes sending, verification, or device actions. */
export const verificationPresentation = (contact: StoredContactIdentity | undefined, availability: 'waiting' | 'unavailable' = 'waiting') => {
  if (contact?.changeStatus === 'changed-pending-review') return { state: 'changed', title: 'Identity changed', description: 'Pause sensitive sharing. Compare the new security code through a trusted channel before accepting this identity.' };
  if (!contact?.identityId) return availability === 'unavailable'
    ? { state: 'unavailable', title: 'Temporarily unavailable', description: 'The authenticated contact identity is unavailable in this view. Unlock your vault and reopen the saved conversation. Existing history and verification records are not deleted.' }
    : { state: 'waiting', title: 'Waiting for authenticated identity', description: 'Verification becomes available after the contact accepts the invitation and their authenticated identity is received. You cannot confirm an identity before its comparison material is available.' };
  if (contact.verification === 'verified' && contact.changeStatus === 'unchanged') return { state: 'verified', title: 'Verified', description: 'You compared this contact’s security code and explicitly verified it on this device. A name alone is not identity proof.' };
  return { state: 'unverified', title: 'Not yet verified', description: 'The authenticated identity is available. Compare security codes in person or through another trusted channel, then explicitly confirm.' };
};
export const permissionLabel = (state: PermissionState | 'unknown' | 'unsupported' | 'default') => ({ granted: 'Allowed', denied: 'Blocked', prompt: 'Ask when needed', default: 'Not granted', unknown: 'Not reported', unsupported: 'Unavailable' })[state];
export const deviceStateLabel = (state: string): string => ({ active: 'Active', revoked: 'Revoked', pending_enrollment: 'Awaiting approval', approved_pending_confirmation: 'Approved · confirmation needed' })[state] ?? 'Status unavailable';
