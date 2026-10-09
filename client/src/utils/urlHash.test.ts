import { encodeSignedModernInvitation, parseInviteFragment, parseInviteInput, parseModernInviteInput } from './urlHash';

const room = 'f64a75a8-cc64-4fa9-89a4-e944ee5f0c64';
const secret = 'A'.repeat(43);
const control = 'B'.repeat(43);
const valid = `#room=${room}&secret=${secret}&control=${control}`;

describe('invitation parser hardening', () => {
  it('accepts the exact supported fragment schema', () => {
    expect(parseInviteFragment(valid)).toEqual({ roomId: room, secret, controlCapability: control });
    expect(parseInviteInput(`https://example.test/${valid}`)).toEqual({ roomId: room, secret, controlCapability: control });
  });

  it.each([
    `#room=${room}&secret=${secret}`,
    `#room=${room}&secret=${secret}&control=short`,
    `#room=../room&secret=${secret}&control=${control}`,
    `#room=${room}&secret=${secret}&control=${control}&critical=1`,
    `#room=${room}&room=${room}&secret=${secret}&control=${control}`,
    `#room=${room}&secret=${secret}&control=${control.repeat(100)}`,
  ])('rejects malformed, duplicated, oversized, or unknown fields: %s', (input) => {
    expect(parseInviteFragment(input)).toBeNull();
  });
});

describe('modern invitation discriminator', () => {
  const address = 'e0baf5c2-c114-4c4d-85a1-1cb2753f74f1';
  it('accepts only the explicit modern fragment', () => {
    const identity = 'K3 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII';
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}&identity=${encodeURIComponent(identity)}`)).toEqual({ version: 1, roomId: room, controlCapability: control, address, identityCommitment: identity });
    expect(parseInviteFragment(`#modern=${room}&control=${control}&address=${address}&identity=${encodeURIComponent(identity)}`)).toBeNull();
    expect(parseModernInviteInput(valid)).toBeNull();
  });

  it('round-trips a signed V2 invitation fragment without exposing raw fields in the URL', () => {
    const invitation = { version: 2 as const, type: 'k3ncrypt-first-contact-invitation' as const,
      invitationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', roomId: room, controlCapability: control, inviterAddress: address,
      identityCommitment: 'K3 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII',
      capabilities: ['join-introduction-v1', 'room-message-v1'] as const, createdAt: 1_700_000_000_000, expiresAt: 1_700_086_400_000,
      signature: 'A'.repeat(86) };
    const fragment = encodeSignedModernInvitation(invitation);
    expect(fragment).toMatch(/^invite=[A-Za-z0-9_-]+$/);
    expect(parseModernInviteInput(`#${fragment}`)).toMatchObject({ version: 2, invitation });
    expect(parseModernInviteInput(`#${fragment.slice(0, -3)}abc`)).toBeNull();
  });
  it('rejects fields that could confuse or downgrade protocol selection', () => {
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}&secret=${secret}`)).toBeNull();
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}&address=${address}`)).toBeNull();
  });
});
