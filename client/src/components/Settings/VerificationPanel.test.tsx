import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerificationPanel } from './VerificationPanel';
jest.mock('../common/StatusPill.css', () => ({}));
const peer = { contactId: 'peer', identityId: 'K3 BBBB CCCC_DDDD', algorithm: 'Olm-Curve25519+Ed25519' as const, publicKey: 'public', verification: 'unverified' as const, changeStatus: 'unchanged' as const };
it('shows a named, explicit verification flow and confines raw codes to security details', () => {
  const action = async () => undefined;
  const markup = renderToStaticMarkup(createElement(VerificationPanel, { label: 'Onnay', ownFingerprint: 'K3 AAAA CCCC_DDDD', contact: peer, sessionHealth: 'healthy', verify: action, unverify: action, acceptChange: action, renew: action, block: action, onError: () => undefined, onDone: () => undefined }));
  expect(markup).toContain('Verify Onnay');
  expect(markup).toContain('Scan their verification QR');
  expect(markup).toContain('Codes match');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Mark as verified<\/button>/);
  expect(markup.split('<details')[0]).not.toContain(peer.identityId);
});
