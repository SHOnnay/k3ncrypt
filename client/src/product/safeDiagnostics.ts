export const SAFE_DIAGNOSTIC_CODES = [
  'FILE_RATE_LIMITED', 'FILE_PREFLIGHT_FAILED', 'FILE_CREATE_FAILED', 'FILE_MANIFEST_UPLOAD_FAILED', 'FILE_CHUNK_UPLOAD_FAILED', 'FILE_FINALIZE_FAILED', 'FILE_REFERENCE_SEND_FAILED', 'FILE_RECIPIENT_FETCH_FAILED', 'FILE_DOWNLOAD_FAILED', 'FILE_AUTHENTICATION_FAILED', 'FILE_SAVE_FAILED', 'FILE_SERVER_STATE_CONFLICT', 'FILE_TRANSFER_EXPIRED', 'FILE_TRANSFER_CANCELED', 'FILE_AUTHORIZATION_FAILED', 'FILE_QUOTA_EXCEEDED',
  'CONVERSATION_RECORD_INVALID', 'CONVERSATION_INVITATION_UNACCEPTED', 'CONVERSATION_INVITATION_EXPIRED', 'CONVERSATION_STATE_INCOMPLETE', 'CONVERSATION_RESTORE_FAILED',
  'CONVERSATION_SESSION_MISSING', 'CONVERSATION_ROOM_MISSING', 'CONTACT_REGISTRY_MISSING', 'CONVERSATION_PREKEY_UNAVAILABLE', 'MESSAGE_HISTORY_ENTRY_QUARANTINED',
  'CONVERSATION_STORAGE_UNAVAILABLE', 'CONVERSATION_STORAGE_CONFLICT', 'CONVERSATION_REMOVED', 'CONVERSATION_INDEX_LIMIT', 'CONVERSATION_LOCAL_RECORD_INVALID',
  'CONVERSATION_IN_USE',
  'CONVERSATION_INVITATION_LOOKUP_FAILED', 'CONVERSATION_OPEN_SUPERSEDED',
  'CONVERSATION_MUX_AUTHENTICATION_REJECTED', 'CONVERSATION_MUX_SUBSCRIPTION_REJECTED', 'CONVERSATION_MUX_HANDLE_UNAVAILABLE', 'CONVERSATION_MUX_PROOF_UNAVAILABLE',
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
    // A server lookup failure says nothing about the presence of local pinned records.
    if (status === 404 && (message.includes('pre-key') || message.includes('prekey'))) return 'CONVERSATION_PREKEY_UNAVAILABLE';
  }
  if (context === 'conversation-open' && message.includes('saved conversation') && message.includes('invalid')) return 'CONVERSATION_RECORD_INVALID';
  if (context === 'conversation-open' && message.includes('active in another tab')) return 'CONVERSATION_IN_USE';
  if (context === 'conversation-open' && message === 'conversation open was superseded.') return 'CONVERSATION_OPEN_SUPERSEDED';
  if (context === 'conversation-open' && message === 'this private invitation expired. create a fresh conversation to continue.') return 'CONVERSATION_INVITATION_LOOKUP_FAILED';
  if (context === 'conversation-open') {
    if (['mux device authentication rejected.', 'device authentication rejected.', 'relay authentication rejected.'].includes(message)) return 'CONVERSATION_MUX_AUTHENTICATION_REJECTED';
    if (['mux room subscription rejected.', 'room subscription rejected.'].includes(message)) return 'CONVERSATION_MUX_SUBSCRIPTION_REJECTED';
    if (['a mux room handle already exists for this room.', 'mux room handle is closed.', 'mux relay connection is closed.'].includes(message)) return 'CONVERSATION_MUX_HANDLE_UNAVAILABLE';
    if (message === 'mux device authorization is unavailable.') return 'CONVERSATION_MUX_PROOF_UNAVAILABLE';
  }
  if (message.includes('session') && (message.includes('missing') || message.includes('not found'))) return 'CONVERSATION_SESSION_MISSING';
  // Only the structured, authenticated room-status probe can classify a terminal room.
  if (context === 'conversation-open' && (message.includes('secure record authentication') || message.includes('protocol record is invalid') || error instanceof SyntaxError)) return 'CONVERSATION_LOCAL_RECORD_INVALID';
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
  if (error instanceof TypeError || message.includes('network') || message.includes('fetch') || message.includes('timeout') || message.includes('timed out') || message.includes('connection refused') || message.includes('transport')) return 'NETWORK_FAILURE';
  if (message.includes('verification') || message.includes('identity') || message.includes('review')) return 'VERIFICATION_REQUIRED';
  return 'UNKNOWN_SAFE_FAILURE';
};

export const logSafeFailure = (event: 'conversation_open_failed' | 'contact_authority_failed' | 'file_send_failed' | 'file_download_failed', reason: SafeDiagnosticCode): void => {
  console.warn('[K3NCRYPT]', { event, reason });
};
