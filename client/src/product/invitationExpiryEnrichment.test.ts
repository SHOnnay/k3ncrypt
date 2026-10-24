import { enrichInvitationExpiries } from './invitationExpiryEnrichment';
import type { ConversationDescriptor } from './sessionStore';
const descriptor = (i: number): ConversationDescriptor => ({ version: 1, roomId: String(i), controlCapability: 'test', label: 'test', updatedAt: 0, relationship: 'invitation' });
it('publishes nothing until a delayed probe completes and stops after a newer generation or lock', async () => {
  let resolve!: (value: number) => void; let current = true;
  const probe = jest.fn(() => new Promise<number>(r => { resolve = r; })); const publish = jest.fn(); const cache = new Map();
  const work = enrichInvitationExpiries([descriptor(1), descriptor(2)], cache, probe, () => current, publish);
  expect(publish).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledTimes(1);
  current = false; resolve(123); await work;
  expect(publish).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledTimes(1); expect(cache.size).toBe(0);
});
it('deduplicates pending probes and bounds work at twelve invitations without probing established contacts', async () => {
  const probe = jest.fn(async () => 123); const cache = new Map(); const publish = jest.fn();
  const descriptors = Array.from({length: 20}, (_, i) => descriptor(i));
  const work = enrichInvitationExpiries(descriptors, cache, probe, () => true, publish);
  await work; expect(probe).toHaveBeenCalledTimes(12);
  await enrichInvitationExpiries(descriptors.slice(0, 12), cache, probe, () => true, publish);
  await enrichInvitationExpiries([{...descriptor(30), remoteAddress: 'pinned-peer'}], cache, probe, () => true, publish);
  expect(probe).toHaveBeenCalledTimes(12);
});
it('leaves unavailable expiry retryable without inventing an expiry', async () => {
  const cache = new Map(); const publish = jest.fn();
  await enrichInvitationExpiries([descriptor(1)], cache, async () => { throw new Error('offline'); }, () => true, publish);
  expect(cache.size).toBe(0); expect(publish).not.toHaveBeenCalled();
});
