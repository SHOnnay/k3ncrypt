import { SignalProofReserve } from './signalProofReserve';
import type { DeviceProofCarrier } from './trustProtocol';

const carrier = (id: number, expiresAt: number): DeviceProofCarrier => ({ proofNonce: `n${id}`, deviceAuthorizationProof: { expiresAt } } as unknown as DeviceProofCarrier);
const resource = { conversationId: 'room' };
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('SignalProofReserve', () => {
  let now = 1_000; let issued = 0;
  const provider = { acquire: jest.fn(async () => carrier(++issued, now + 30_000)) };
  const reserve = (): SignalProofReserve => new SignalProofReserve(provider, () => now);
  beforeEach(() => { now = 1_000; issued = 0; provider.acquire.mockClear(); });

  it('hands out a warmed proof without waiting for the network', async () => {
    const proofs = reserve(); proofs.warm(resource); await flush();
    const before = provider.acquire.mock.calls.length;
    expect((await proofs.acquire('relay:signal', resource)).proofNonce).toBe('n1');
    await flush();
    expect(provider.acquire.mock.calls.length).toBe(before + 1); // refilled in the background, not awaited
    proofs.cool();
  });
  it('never hands out the same proof twice', async () => {
    const proofs = reserve(); proofs.warm(resource); await flush();
    const taken = await Promise.all([proofs.acquire('relay:signal', resource), proofs.acquire('relay:signal', resource), proofs.acquire('relay:signal', resource)]);
    expect(new Set(taken.map((item) => item.proofNonce)).size).toBe(3);
    proofs.cool();
  });
  it('fetches fresh when a held proof is close to expiry', async () => {
    const proofs = reserve(); proofs.warm(resource); await flush();
    now += 26_000;
    const fresh = await proofs.acquire('relay:signal', resource);
    expect(fresh.deviceAuthorizationProof.expiresAt).toBeGreaterThan(now + 25_000);
    proofs.cool();
  });
  it('does not touch other operations or other rooms', async () => {
    const proofs = reserve(); proofs.warm(resource); await flush();
    provider.acquire.mockClear();
    await proofs.acquire('relay:message', resource);
    expect(provider.acquire).toHaveBeenCalledWith('relay:message', resource);
    await proofs.acquire('relay:signal', { conversationId: 'other' });
    expect(provider.acquire).toHaveBeenCalledWith('relay:signal', { conversationId: 'other' });
    proofs.cool();
  });
  it('drops every held proof when the call ends', async () => {
    const proofs = reserve(); proofs.warm(resource); await flush();
    proofs.cool(); provider.acquire.mockClear();
    await proofs.acquire('relay:signal', resource);
    expect(provider.acquire).toHaveBeenCalledTimes(1);
  });
  it('keeps working when warming fails', async () => {
    provider.acquire.mockRejectedValueOnce(new Error('offline'));
    const proofs = reserve(); proofs.warm(resource); await flush();
    await expect(proofs.acquire('relay:signal', resource)).resolves.toBeDefined();
    proofs.cool();
  });
});
