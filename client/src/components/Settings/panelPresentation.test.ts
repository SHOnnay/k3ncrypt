import { deviceStateLabel, permissionLabel, verificationPresentation } from './panelPresentation';
const peer = { contactId: 'synthetic', identityId: 'K3 synthetic', publicKey: 'synthetic', algorithm: 'Olm-Curve25519+Ed25519', verification: 'unverified' as const, changeStatus: 'unchanged' as const };
it('keeps waiting, unavailable, unverified, verified and changed states distinct', () => {
  expect(verificationPresentation(undefined).state).toBe('waiting');
  expect(verificationPresentation(undefined, 'unavailable').state).toBe('unavailable');
  expect(verificationPresentation(peer).state).toBe('unverified');
  expect(verificationPresentation({ ...peer, verification: 'verified' }).state).toBe('verified');
  expect(verificationPresentation({ ...peer, verification: 'verified', changeStatus: 'changed-pending-review' }).state).toBe('changed');
});
it('cannot turn missing identity material into a verified status', () => {
  expect(verificationPresentation({ ...peer, verification: 'verified', identityId: '' }).state).toBe('waiting');
});
it('does not treat approval pending as active or revoked as approved', () => {
  expect(deviceStateLabel('approved_pending_confirmation')).toBe('Approved · confirmation needed');
  expect(deviceStateLabel('pending_enrollment')).toBe('Awaiting approval');
  expect(deviceStateLabel('revoked')).toBe('Revoked');
  expect(deviceStateLabel('unexpected')).toBe('Status unavailable');
});
it.each([['granted', 'Allowed'], ['prompt', 'Ask when needed'], ['denied', 'Blocked'], ['unknown', 'Not reported'], ['unsupported', 'Unavailable'], ['default', 'Not granted']] as const)('describes %s permission without inventing grants', (input, expected) => {
  expect(permissionLabel(input)).toBe(expected);
});
