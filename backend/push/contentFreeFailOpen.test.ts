import { notifyEncryptedMailboxStored, pushConfigured, recordAdmittedPushRoute, startPrivateWakeWorker, wakePayload } from './privateWake';
import { WakeDispatcher } from './wakeDispatcher';
import type { Db } from 'mongodb';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('N1 push wake-up is content-free [unit test]', () => {
  it('carries only a type, a random event id and two timestamps: no names, text, sender, room or token', () => {
    const payload = wakePayload(1_000_000);
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
    expect(payload.type).toBe('encrypted-activity');
    expect(Object.values(payload).every((value) => typeof value === 'string')).toBe(true);
    expect(Number(payload.expiresAt) - Number(payload.createdAt)).toBe(60_000);
    expect(wakePayload(1_000_000).eventId).not.toBe(payload.eventId);
  });
  it('gives the provider exactly that payload and nothing else', async () => {
    const sent: Array<{ token: string; data: Record<string, unknown> }> = [];
    const row = { _id: 'h', token: 'tok'.repeat(8), accountIdentityReference: 'a', deviceId: 'd', deviceIdentityReference: 'i', trustEpoch: 1, updatedAt: new Date(0) };
    const store = { isCurrent: async () => true, removeObserved: async () => true, readActive: async () => ({ accountIdentityReference: 'a', deviceId: 'd', state: 'active', trustEpoch: 1, deviceIdentityReference: 'i' }) as never };
    const dispatcher = new WakeDispatcher(store, async (token, data) => { sent.push({ token, data: data as unknown as Record<string, unknown> }); }, () => true, wakePayload);
    expect(await dispatcher.dispatch(row)).toBe('accepted');
    expect(Object.keys(sent[0].data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
  });
});

describe('N1 push is rate limited [unit test]', () => {
  const row = { _id: 'h', token: 'tok'.repeat(8), accountIdentityReference: 'a', deviceId: 'd', deviceIdentityReference: 'i', trustEpoch: 1, updatedAt: new Date(0) };
  const store = { isCurrent: async () => true, removeObserved: async () => true, readActive: async () => ({ accountIdentityReference: 'a', deviceId: 'd', state: 'active', trustEpoch: 1, deviceIdentityReference: 'i' }) as never };
  it('sends at most one wake per device token every 30 seconds', async () => {
    let now = 5_000_000; const provider = jest.fn(async () => undefined);
    const dispatcher = new WakeDispatcher(store, provider, () => true, wakePayload, () => now);
    expect(await dispatcher.dispatch(row)).toBe('accepted');
    expect(await dispatcher.dispatch(row)).toBe('throttled');
    now += 31_000;
    expect(await dispatcher.dispatch(row)).toBe('accepted');
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('N1 push fails open when not configured [unit test]', () => {
  beforeEach(() => { delete process.env.K3NCRYPT_FCM_ENABLED; delete process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH; delete process.env.K3NCRYPT_FCM_PROJECT_ID; });
  it('is off by default and when any setting is missing', () => {
    expect(pushConfigured()).toBe(false);
    process.env.K3NCRYPT_FCM_ENABLED = 'true'; expect(pushConfigured()).toBe(false);
    process.env.K3NCRYPT_FCM_PROJECT_ID = 'p'; expect(pushConfigured()).toBe(false);
    process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH = '/does/not/exist.json'; expect(pushConfigured()).toBe(false);
  });
  it('does nothing, touches no database and throws nothing for mail and route admission', () => {
    const db = new Proxy({}, { get: () => { throw new Error('database must not be touched'); } }) as unknown as Db;
    expect(() => notifyEncryptedMailboxStored(db, 'room', 'mailbox', 'id')).not.toThrow();
    expect(() => recordAdmittedPushRoute(db, { account: 'a', device: 'd', epoch: 1, room: 'r', address: 'x', control: 'c', routingProof: 'p', current: () => true })).not.toThrow();
    const stop = startPrivateWakeWorker(db); expect(typeof stop).toBe('function'); expect(() => stop()).not.toThrow();
  });
});
