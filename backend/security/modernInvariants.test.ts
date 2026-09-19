import { isValidWireEnvelope, MAX_ENVELOPE_BYTES, MAX_OFFLINE_PER_MAILBOX } from '../socket.io/listeners';

describe('relay security invariants', () => {
  it('rejects malformed wire envelopes before relay handling', () => {
    expect(isValidWireEnvelope({ version: 2, strategy: 'vodozemac-olm-v1', data: {} })).toBe(true);
    expect(isValidWireEnvelope({ version: 2, strategy: 'vodozemac-olm-v1', data: {}, extra: 'secret' })).toBe(false);
  });

  it('keeps offline storage bounded', () => {
    expect(MAX_ENVELOPE_BYTES).toBe(32 * 1024);
    expect(MAX_OFFLINE_PER_MAILBOX).toBe(64);
  });
});
