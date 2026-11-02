import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerificationPanel } from './VerificationPanel';
jest.mock('../common/StatusPill.css', () => ({}));
const peer = { contactId: 'peer', identityId: 'K3 BBBB CCCC_DDDD', algorithm: 'Olm-Curve25519+Ed25519' as const, publicKey: 'public', verification: 'unverified' as const, changeStatus: 'unchanged' as const };
// M1c Option B: start by asking about Android (no QR/numbers parity yet), then together vs call.
it('starts a named, explicit check flow and confines full security numbers to More options', () => {
  const action = async () => undefined;
  const markup = renderToStaticMarkup(createElement(VerificationPanel, { label: 'Onnay', ownFingerprint: 'K3 AAAA CCCC_DDDD', contact: peer, sessionHealth: 'healthy', verify: action, unverify: action, acceptChange: action, renew: action, block: action, onError: () => undefined, onDone: () => undefined }));
  expect(markup).toContain('Check it’s really Onnay');
  expect(markup).toContain('Not checked yet');
  expect(markup).toContain('Is Onnay using K3NCRYPT on an Android phone?');
  expect(markup).toContain('Yes, Android');
  // Nothing on the first screen can change trust.
  expect(markup).not.toContain('They match'); expect(markup).not.toContain('>Confirm<');
  // Plain words in the flow itself; the raw code-as-text lives only under More options.
  expect(markup.split('<details class="verification-security-details"')[0].replace(/<[^>]*>/g, ' ')).not.toMatch(/fingerprint|payload|pinned|identity key/i);
  expect(markup.split('<details')[0]).not.toContain(peer.identityId);
});
it.each(['waiting', 'unavailable'] as const)('does not offer identity confirmation without comparison material: %s', availability => {
  const action = async () => undefined;
  const markup = renderToStaticMarkup(createElement(VerificationPanel, { label: 'Contact · 00DB', ownFingerprint: 'K3 AAAA CCCC_DDDD', availability, sessionHealth: 'healthy', verify: action, unverify: action, acceptChange: action, renew: action, block: action, onError: () => undefined, onDone: () => undefined }));
  expect(markup).toContain('Check it’s really your contact');
  expect(markup.split('<details')[0]).not.toContain('Contact · 00DB');
  expect(markup).not.toContain('They match'); expect(markup).not.toContain('>Confirm<'); expect(markup).not.toContain('Yes, Android');
  expect(markup).toContain(availability === 'waiting' ? 'Waiting for them to accept' : 'Not available right now');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Check their code<\/button>/);
});
