import { CALL_WAKE_LIFETIME_MS, CallWakeLimiter, callWakeEnabled, callWakePayload, requestCallWake, validWakeId } from './callWake';
import type { Db } from 'mongodb';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const wakeId = '3f1c2a9e-5b7d-4c11-8a42-0e6d9b7a1c55';

describe('call wake payload [unit test]', () => {
  it('has exactly the five content-free keys and a 45 s lifetime', () => {
    const ring = callWakePayload('call', wakeId, 1_000_000);
    expect(Object.keys(ring).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
    expect(ring).toEqual({ version: '1', type: 'call', eventId: wakeId, createdAt: '1000000', expiresAt: String(1_000_000 + CALL_WAKE_LIFETIME_MS) });
    expect(CALL_WAKE_LIFETIME_MS).toBe(45_000);
    expect(callWakePayload('call-cancel', wakeId, 5).type).toBe('call-cancel');
  });
  it('accepts only canonical uuids as wake ids', () => {
    expect(validWakeId(wakeId)).toBe(true);
    for (const bad of ['', 'x', 'not-a-uuid', wakeId.toUpperCase(), `${wakeId}0`, 12, null, undefined, { a: 1 }]) expect(validWakeId(bad)).toBe(false);
  });
});

describe('call wake switch [unit test]', () => {
  const configured = () => { process.env.K3NCRYPT_FCM_ENABLED = 'true'; process.env.K3NCRYPT_FCM_PROJECT_ID = 'p'; process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH = __filename; };
  it('is off by default, even when push itself is configured', () => {
    configured(); delete process.env.K3NCRYPT_CALL_WAKE_ENABLED; expect(callWakeEnabled()).toBe(false);
    process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'false'; expect(callWakeEnabled()).toBe(false);
  });
  it('is off when push is not configured, whatever the call switch says', () => {
    process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'true'; delete process.env.K3NCRYPT_FCM_ENABLED; expect(callWakeEnabled()).toBe(false);
  });
  it('is off in maintenance mode and on only when everything is set', () => {
    configured(); process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'true'; process.env.K3NCRYPT_MAINTENANCE_MODE = 'true'; expect(callWakeEnabled()).toBe(false);
    process.env.K3NCRYPT_MAINTENANCE_MODE = 'false'; expect(callWakeEnabled()).toBe(true);
  });
  it('requestCallWake does nothing, touches no database and throws nothing while off', () => {
    delete process.env.K3NCRYPT_CALL_WAKE_ENABLED;
    const db = new Proxy({}, { get: () => { throw new Error('database must not be touched'); } }) as unknown as Db;
    expect(() => requestCallWake(db, { room: 'r', recipient: 'x', callerAccount: 'a', callerDevice: 'd', wakeId, kind: 'ring' })).not.toThrow();
    expect(() => requestCallWake(undefined, { room: 'r', recipient: 'x', callerAccount: 'a', callerDevice: 'd', wakeId, kind: 'cancel' })).not.toThrow();
  });
});

describe('call wake limits [unit test]', () => {
  it('limits one caller device: burst of 4, then one per 15 s', () => {
    const limiter = new CallWakeLimiter(); const t0 = 1_000_000;
    expect([0, 1, 2, 3].map(() => limiter.admitCaller('c', t0))).toEqual([true, true, true, true]);
    expect(limiter.admitCaller('c', t0)).toBe(false);
    expect(limiter.admitCaller('c', t0 + 15_000)).toBe(true);
    expect(limiter.admitCaller('other', t0)).toBe(true);
  });
  it('caps a caller at 40 an hour even with steady spacing', () => {
    const limiter = new CallWakeLimiter(); let admitted = 0;
    for (let i = 0; i < 100; i++) if (limiter.admitCaller('c', 5_000_000 + i * 16_000)) admitted++;
    expect(admitted).toBe(40);
  });
  it('keeps the same caller and target at least 8 s apart', () => {
    const limiter = new CallWakeLimiter(); const t0 = 9_000_000;
    expect(limiter.admitPair('p', t0)).toBe(true); expect(limiter.admitPair('p', t0 + 7_999)).toBe(false); expect(limiter.admitPair('p', t0 + 8_000)).toBe(true);
  });
  it('limits a target token: burst of 3, then one per 20 s, 30 an hour', () => {
    const limiter = new CallWakeLimiter(); const t0 = 20_000_000;
    expect([0, 1, 2].map(() => limiter.admitTarget('t', t0))).toEqual([true, true, true]);
    expect(limiter.admitTarget('t', t0)).toBe(false); expect(limiter.admitTarget('t', t0 + 20_000)).toBe(true);
  });
  it('has a global per-minute ceiling', () => {
    const limiter = new CallWakeLimiter(); const t0 = 30_000_000; let admitted = 0;
    for (let i = 0; i < 200; i++) if (limiter.admitGlobal(t0)) admitted++;
    expect(admitted).toBe(120);
  });
});
