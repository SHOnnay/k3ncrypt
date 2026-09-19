import { parseInviteFragment, parseInviteInput, parseModernInviteInput } from './urlHash';

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
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}`)).toEqual({ roomId: room, controlCapability: control, address });
    expect(parseInviteFragment(`#modern=${room}&control=${control}&address=${address}`)).toBeNull();
    expect(parseModernInviteInput(valid)).toBeNull();
  });
  it('rejects fields that could confuse or downgrade protocol selection', () => {
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}&secret=${secret}`)).toBeNull();
    expect(parseModernInviteInput(`#modern=${room}&control=${control}&address=${address}&address=${address}`)).toBeNull();
  });
});
