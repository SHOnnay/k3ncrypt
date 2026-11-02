import { receiveLegacyMediaFromVerifiedContact } from './mediaTrust';

describe('legacy media trust gate (P0-1b)', () => {
  it('never fetches media when the contact is not verified and unchanged', async () => {
    const receive = jest.fn(async () => 'bytes');
    const refuse = jest.fn(async () => { throw new Error('Verified unchanged contact required.'); });
    await expect(receiveLegacyMediaFromVerifiedContact(refuse, receive)).rejects.toThrow('Verified unchanged contact required.');
    expect(receive).not.toHaveBeenCalled();
  });

  it('fetches only after verified authority succeeds', async () => {
    const order: string[] = [];
    const result = await receiveLegacyMediaFromVerifiedContact(async () => { order.push('authority'); }, async () => { order.push('receive'); return 'bytes'; });
    expect(result).toBe('bytes');
    expect(order).toEqual(['authority', 'receive']);
  });
});
