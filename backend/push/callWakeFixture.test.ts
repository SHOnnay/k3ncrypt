import { readFileSync } from 'fs';
import { CALL_WAKE_LIFETIME_MS, callWakePayload, validWakeId } from './callWake';

/** Guard: what the relay sends for a call wake is exactly the shared fixture's shape, which the Android policy test also reads. */
const fixture = JSON.parse(readFileSync('protocol-fixtures/v1/call-wake.json', 'utf8')) as {
  maxLifetimeMs: number; keys: string[]; accept: { kind: 'ring' | 'cancel'; data: Record<string, string> }[]; reject: { why: string; data: Record<string, string> }[];
};

test('the relay builds exactly the content-free payload the fixture accepts', () => {
  expect(CALL_WAKE_LIFETIME_MS).toBeLessThanOrEqual(fixture.maxLifetimeMs);
  for (const sample of fixture.accept) {
    const created = Number(sample.data.createdAt);
    const built = callWakePayload(sample.kind === 'ring' ? 'call' : 'call-cancel', sample.data.eventId, created);
    expect(Object.keys(built).sort()).toEqual(fixture.keys);
    expect(built).toEqual(sample.data);
    expect(Object.values(built).every((value) => typeof value === 'string')).toBe(true);
    expect(validWakeId(sample.data.eventId)).toBe(true);
  }
});

test('every rejected sample differs from what the relay can build', () => {
  for (const sample of fixture.reject) {
    const keysMatch = Object.keys(sample.data).sort().join() === fixture.keys.join();
    const type = sample.data.type;
    const buildable = keysMatch && sample.data.version === '1' && (type === 'call' || type === 'call-cancel') && validWakeId(sample.data.eventId) &&
      Number(sample.data.expiresAt) - Number(sample.data.createdAt) === CALL_WAKE_LIFETIME_MS;
    // "already expired" and "created in the future" are well-formed; only the phone's clock rejects them.
    if (!['already expired', 'created in the future'].includes(sample.why)) expect({ why: sample.why, buildable }).toEqual({ why: sample.why, buildable: false });
  }
});
