export const SAFE_DIAGNOSTIC_CODES = [
  'FILE_RATE_LIMITED', 'FILE_PREFLIGHT_FAILED', 'FILE_CREATE_FAILED', 'FILE_MANIFEST_UPLOAD_FAILED', 'FILE_CHUNK_UPLOAD_FAILED', 'FILE_FINALIZE_FAILED', 'FILE_REFERENCE_SEND_FAILED', 'FILE_RECIPIENT_FETCH_FAILED', 'FILE_DOWNLOAD_FAILED', 'FILE_AUTHENTICATION_FAILED', 'FILE_SAVE_FAILED', 'FILE_SERVER_STATE_CONFLICT', 'FILE_TRANSFER_EXPIRED', 'FILE_TRANSFER_CANCELED', 'FILE_AUTHORIZATION_FAILED', 'FILE_QUOTA_EXCEEDED',
  'CONVERSATION_RECORD_INVALID', 'CONVERSATION_INVITATION_UNACCEPTED', 'CONVERSATION_INVITATION_EXPIRED', 'CONVERSATION_STATE_INCOMPLETE', 'CONVERSATION_RESTORE_FAILED',
  'CONVERSATION_SESSION_MISSING', 'CONVERSATION_ROOM_MISSING', 'CONTACT_REGISTRY_MISSING', 'MESSAGE_HISTORY_ENTRY_QUARANTINED',
  'PINNED_IDENTITY_MISSING', 'PINNED_IDENTITY_CHANGED', 'VERIFICATION_RECORD_MISSING',
  'VERIFICATION_RESET_LOCAL', 'CURRENT_IDENTITY_UNAVAILABLE', 'ROOM_MEMBERSHIP_MISMATCH',
  'RECIPIENT_AUTHORITY_MISSING', 'RECIPIENT_AUTHORITY_CHANGED', 'FILE_RECIPIENT_BINDING_MISMATCH',
  'SERVICE_NOT_READY', 'NETWORK_FAILURE', 'VERIFICATION_REQUIRED', 'UNKNOWN_SAFE_FAILURE',
] as const;

export type SafeDiagnosticCode = typeof SAFE_DIAGNOSTIC_CODES[number];
export type DiagnosticContext = 'conversation-open' | 'contact-authority' | 'file-send';

export const safeFailureCopy = (context: DiagnosticContext): string => {
  if (context === 'conversation-open') return 'This saved conversation could not be opened.';
  if (context === 'file-send') return 'This protected file send could not be completed.';
  return 'K3NCRYPT can’t confirm this contact right now.';
};

const allowed = new Set<string>(SAFE_DIAGNOSTIC_CODES);

export const classifySafeDiagnostic = (context: DiagnosticContext, error: unknown): SafeDiagnosticCode => {
  if (error && typeof error === 'object') {
    const tagged = (error as { safeDiagnosticCode?: unknown; restoreFailureCategory?: unknown }).safeDiagnosticCode;
    if (typeof tagged === 'string' && allowed.has(tagged)) return tagged as SafeDiagnosticCode;
    if ((error as { restoreFailureCategory?: unknown }).restoreFailureCategory === 'session-record-missing') return 'CONVERSATION_SESSION_MISSING';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : typeof error === 'string' ? error.toLowerCase() : '';
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (context === 'conversation-open' && typeof status === 'number') {
    if (status === 408 || status === 425 || status === 429 || status >= 500 && status <= 599) return 'NETWORK_FAILURE';
    if (status === 404 && (message.includes('pre-key') || message.includes('prekey'))) return 'CONTACT_REGISTRY_MISSING';
  }
  if (context === 'conversation-open' && message.includes('saved conversation') && message.includes('invalid')) return 'CONVERSATION_RECORD_INVALID';
  if (message.includes('session') && (message.includes('missing') || message.includes('not found'))) return 'CONVERSATION_SESSION_MISSING';
  if (message.includes('conversation') && (message.includes('unavailable') || message.includes('not found'))) return 'CONVERSATION_ROOM_MISSING';
  if (message.includes('unknown contact identity')) return 'CONTACT_REGISTRY_MISSING';
  if (message.includes('file contact verification unavailable') || message.includes('verification record') && message.includes('missing')) return 'VERIFICATION_RECORD_MISSING';
  if (message.includes('trust reset')) return 'VERIFICATION_RESET_LOCAL';
  if (message.includes('unlock this device') || message.includes('current identity unavailable')) return 'CURRENT_IDENTITY_UNAVAILABLE';
  if (message.includes('contact identity') && message.includes('unavailable')) return 'PINNED_IDENTITY_MISSING';
  if (message.includes('identity changed') || message.includes('changed-pending-review') || message.includes('identity does not match')) return 'PINNED_IDENTITY_CHANGED';
  if (message.includes('verification reset')) return 'VERIFICATION_RESET_LOCAL';
  if (message.includes('current identity') && message.includes('unavailable')) return 'CURRENT_IDENTITY_UNAVAILABLE';
  if (message.includes('room membership')) return 'ROOM_MEMBERSHIP_MISMATCH';
  if (message.includes('recipient authority') && message.includes('changed')) return 'RECIPIENT_AUTHORITY_CHANGED';
  if (message.includes('recipient identity') && message.includes('changed')) return 'RECIPIENT_AUTHORITY_CHANGED';
  if (message.includes('recipient authority') || message.includes('verified unchanged contact required')) return 'RECIPIENT_AUTHORITY_MISSING';
  if (message.includes('file identity binding') || message.includes('file recipient binding')) return 'FILE_RECIPIENT_BINDING_MISMATCH';
  if (message.includes('not initialized') || message.includes('service not ready')) return 'SERVICE_NOT_READY';
  if (error instanceof TypeError || message.includes('network') || message.includes('fetch')) return 'NETWORK_FAILURE';
  if (message.includes('verification') || message.includes('identity') || message.includes('review')) return 'VERIFICATION_REQUIRED';
  if (context === 'conversation-open' && message.includes('room')) return 'CONVERSATION_ROOM_MISSING';
  return 'UNKNOWN_SAFE_FAILURE';
};

export const logSafeFailure = (event: 'conversation_open_failed' | 'contact_authority_failed' | 'file_send_failed' | 'file_download_failed', reason: SafeDiagnosticCode): void => {
  console.warn('[K3NCRYPT]', { event, reason });
};
