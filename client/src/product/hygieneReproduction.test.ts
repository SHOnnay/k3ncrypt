import { classifySafeDiagnostic } from './safeDiagnostics';
it('maps authoritative invitation expiry without inferring expiry from a failed pre-key lookup', () => {
  expect(classifySafeDiagnostic('conversation-open', { safeDiagnosticCode: 'CONVERSATION_INVITATION_EXPIRED' })).toBe('CONVERSATION_INVITATION_EXPIRED');
  expect(classifySafeDiagnostic('conversation-open', { safeDiagnosticCode: 'CONVERSATION_RESTORE_FAILED' })).toBe('CONVERSATION_RESTORE_FAILED');
});
