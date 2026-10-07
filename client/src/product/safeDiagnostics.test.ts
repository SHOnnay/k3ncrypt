import { classifySafeDiagnostic, SAFE_DIAGNOSTIC_CODES, safeFailureCopy, logSafeFailure } from './safeDiagnostics';

describe('safe diagnostics', () => {
  it.each([
    ['CONVERSATION_SESSION_MISSING', Object.assign(new Error('session missing secret=do-not-log'), { restoreFailureCategory: 'session-record-missing' }), 'conversation-open'],
    ['CONVERSATION_ROOM_MISSING', new Error('Conversation is unavailable.'), 'conversation-open'],
    ['CONTACT_REGISTRY_MISSING', Object.assign(new Error('x'), { safeDiagnosticCode: 'CONTACT_REGISTRY_MISSING' }), 'contact-authority'],
    ['PINNED_IDENTITY_MISSING', new Error('Contact identity is unavailable.'), 'contact-authority'],
    ['PINNED_IDENTITY_CHANGED', new Error('Identity changed; review required.'), 'contact-authority'],
    ['VERIFICATION_RECORD_MISSING', Object.assign(new Error('x'), { safeDiagnosticCode: 'VERIFICATION_RECORD_MISSING' }), 'contact-authority'],
    ['VERIFICATION_RESET_LOCAL', new Error('Verification reset locally.'), 'contact-authority'],
    ['CURRENT_IDENTITY_UNAVAILABLE', new Error('Current identity unavailable.'), 'contact-authority'],
    ['ROOM_MEMBERSHIP_MISMATCH', new Error('Room membership mismatch.'), 'conversation-open'],
    ['RECIPIENT_AUTHORITY_MISSING', new Error('Verified unchanged contact required.'), 'file-send'],
    ['RECIPIENT_AUTHORITY_CHANGED', new Error('Recipient authority changed.'), 'file-send'],
    ['FILE_RECIPIENT_BINDING_MISMATCH', new Error('File identity binding rejected.'), 'file-send'],
    ['SERVICE_NOT_READY', new Error('Service not initialized.'), 'conversation-open'],
    ['NETWORK_FAILURE', new TypeError('Failed to fetch https://secret.example/token/abc'), 'conversation-open'],
    ['NETWORK_FAILURE', Object.assign(new Error('service unavailable'), { status: 503 }), 'conversation-open'],
    ['NETWORK_FAILURE', Object.assign(new Error('rate limited'), { status: 429 }), 'conversation-open'],
    ['CONTACT_REGISTRY_MISSING', Object.assign(new Error('Pre-key bundle unavailable'), { status: 404 }), 'conversation-open'],
    ['VERIFICATION_REQUIRED', new Error('Verification required.'), 'contact-authority'],
    ['UNKNOWN_SAFE_FAILURE', new Error('opaque private detail'), 'file-send'],
  ] as const)('maps to %s', (expected, error, context) => {
    expect(classifySafeDiagnostic(context, error)).toBe(expected);
  });

  it('never returns exception text or unapproved codes', () => {
    const secret = 'fingerprint=abc room=private token=secret /Users/person/file.txt';
    const error = Object.assign(new Error(secret), { safeDiagnosticCode: secret });
    const code = classifySafeDiagnostic('file-send', error);
    expect(SAFE_DIAGNOSTIC_CODES).toContain(code);
    expect(JSON.stringify({ code })).not.toContain(secret);
    expect(code).toBe('UNKNOWN_SAFE_FAILURE');
  });

  it('uses ordinary safe copy and logs only the allowlisted event and code', () => {
    expect(safeFailureCopy('conversation-open')).toBe('This saved conversation could not be opened.');
    expect(safeFailureCopy('file-send')).toBe('This protected file send could not be completed.');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSafeFailure('file_send_failed', 'RECIPIENT_AUTHORITY_CHANGED');
    expect(warn).toHaveBeenCalledWith('[K3NCRYPT]', { event: 'file_send_failed', reason: 'RECIPIENT_AUTHORITY_CHANGED' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/fingerprint|token|room|transfer|ip address/i);
    warn.mockRestore();
  });
});
