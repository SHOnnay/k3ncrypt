import type { DeviceLifecycleRecord } from '../security/deviceTrust';
import type { PushRow, WakePayload } from './privateWake';

export interface WakeRegistrationStore {
  isCurrent(row: PushRow): Promise<boolean>;
  removeObserved(row: PushRow): Promise<boolean>;
  readActive(account: string, device: string): Promise<DeviceLifecycleRecord | undefined>;
}
export type WakeProvider = (token: string, data: WakePayload, ttl: number) => Promise<void>;
export type WakeResult = 'disabled' | 'busy' | 'coalesced' | 'throttled' | 'accepted' | 'failed' | 'expired' | 'rejected' | 'timeout' | 'retry' | 'rate-limited' | 'deferred';
export type WakeCounters = Record<'attempted' | 'accepted' | 'rejected' | 'expired' | 'failed' | 'timedOut' | 'retired' | 'coalesced' | 'throttled' | 'busy', number>;
export const emptyWakeCounters = (): WakeCounters => ({ attempted: 0, accepted: 0, rejected: 0, expired: 0, failed: 0, timedOut: 0, retired: 0, coalesced: 0, throttled: 0, busy: 0 });

/** Only the two token-specific SDK failures justify retiring a registration. Invalid payload/auth errors do not. */
export const classifyWakeFailure = (error: unknown): 'invalid-token' | 'transient' | 'rate-limited' | 'permanent' => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') return 'invalid-token';
  if (code === 'messaging/quota-exceeded' || code === 'messaging/message-rate-exceeded' || code === 'messaging/device-message-rate-exceeded') return 'rate-limited';
  if (['messaging/server-unavailable', 'messaging/internal-error', 'app/network-error', 'app/network-timeout'].includes(code as string)) return 'transient';
  return 'permanent';
};

export type DurableDispatchOptions = { data: WakePayload; authorized: () => Promise<boolean>; beforeSend: () => Promise<boolean>; allowed?: () => boolean };

type Job = { providerRunning: boolean; finished: boolean };
type Attempt = 'accepted' | 'timeout' | 'invalid-token' | 'transient' | 'rate-limited' | 'permanent';

/** Process-local Phase A only. No mailbox mutation, durable queue, worker timer, or delivery receipt. */
export class WakeDispatcher {
  private readonly jobs = new Map<string, Job>();
  private readonly acceptedAt = new Map<string, number>();
  private readonly counters = emptyWakeCounters();
  constructor(
    private readonly store: WakeRegistrationStore,
    private readonly provider: WakeProvider,
    private readonly enabled: () => boolean,
    private readonly payload: (now: number) => WakePayload,
    private readonly now: () => number = Date.now,
    private readonly pause: (millis: number) => Promise<void> = (millis) => new Promise((resolve) => setTimeout(resolve, millis)),
  ) {}
  snapshot(): Readonly<WakeCounters> { return { ...this.counters }; }
  lookupRejected(): void { this.count('rejected'); }
  lookupFailed(): void { this.count('failed'); }
  private count(key: keyof WakeCounters): void { this.counters[key] = Math.min(Number.MAX_SAFE_INTEGER, this.counters[key] + 1); }

  async dispatch(row: PushRow, durable?: DurableDispatchOptions): Promise<WakeResult> {
    if (!this.enabled()) return 'disabled';
    if (this.jobs.has(row._id)) { this.count('coalesced'); return 'coalesced'; }
    if (this.jobs.size >= 32) { this.count('busy'); return 'busy'; }
    const accepted = this.acceptedAt.get(row._id);
    if (!durable && accepted !== undefined && this.now() - accepted < 30_000) { this.count('throttled'); return 'throttled'; }
    const job: Job = { providerRunning: false, finished: false };
    this.jobs.set(row._id, job);
    try { return await this.run(row, job, durable); }
    catch { this.count('failed'); return 'failed'; }
    finally {
      job.finished = true;
      // SDK sends cannot be aborted. A timed-out operation keeps its slot until it really settles.
      if (!job.providerRunning && this.jobs.get(row._id) === job) this.jobs.delete(row._id);
    }
  }

  private async run(row: PushRow, job: Job, durable?: DurableDispatchOptions): Promise<WakeResult> {
    const data = durable?.data ?? this.payload(this.now());
    const expires = Number(data.expiresAt);
    for (let attempt = 0; attempt < (durable ? 1 : 3); attempt++) {
      if (!this.enabled()) return 'disabled';
      if (this.now() >= expires) { this.count('expired'); return 'expired'; }
      if (!await this.store.isCurrent(row)) { this.count('rejected'); return 'rejected'; }
      const active = await this.store.readActive(row.accountIdentityReference, row.deviceId);
      if (!active || active.accountIdentityReference !== row.accountIdentityReference || active.deviceId !== row.deviceId || active.state !== 'active' || active.trustEpoch !== row.trustEpoch || active.deviceIdentityReference !== row.deviceIdentityReference) {
        if (await this.store.removeObserved(row)) this.count('retired');
        this.count('rejected'); return 'rejected';
      }
      // Recheck after suspended authorization reads. The provider never confers authority.
      if (!this.enabled()) return 'disabled';
      if (this.now() >= expires) { this.count('expired'); return 'expired'; }
      if (!await this.store.isCurrent(row)) { this.count('rejected'); return 'rejected'; }
      const remaining = expires - this.now();
      if (remaining <= 0) { this.count('expired'); return 'expired'; }
      if (durable && !await durable.authorized()) { this.count('rejected'); return 'rejected'; }
      if (durable && !await durable.beforeSend()) return 'deferred';
      const ttl = expires - this.now();
      if (ttl <= 0) { this.count('expired'); return 'expired'; }
      const result = await this.send(row, data, ttl, job, durable?.allowed);
      if (result === 'accepted') {
        this.count('accepted'); this.acceptedAt.set(row._id, this.now());
        while (this.acceptedAt.size > 512) this.acceptedAt.delete(this.acceptedAt.keys().next().value!);
        return 'accepted';
      }
      if (result === 'timeout') { this.count('timedOut'); this.count('failed'); return 'timeout'; }
      if (result === 'invalid-token') {
        if (await this.store.removeObserved(row)) this.count('retired');
        this.count('rejected'); return 'rejected';
      }
      // Quota responses require at least a minute's backoff; never retry within this 60s wake.
      if (durable && result === 'transient') { this.count('failed'); return 'retry'; }
      if (durable && result === 'rate-limited') { this.count('failed'); return 'rate-limited'; }
      if (result !== 'transient' || attempt === 2) { this.count('failed'); return 'failed'; }
      await this.pause(250 * 2 ** attempt);
    }
    return 'failed';
  }

  private async send(row: PushRow, data: WakePayload, ttl: number, job: Job, allowed?: () => boolean): Promise<Attempt> {
    this.count('attempted'); job.providerRunning = true;
    const settled = Promise.resolve().then(() => { if (allowed && !allowed()) throw new Error('WAKE_STOPPED'); return this.provider(row.token, data, ttl); }).then(
      (): Attempt => 'accepted', (error): Attempt => classifyWakeFailure(error),
    ).then((result) => {
      job.providerRunning = false;
      if (job.finished && this.jobs.get(row._id) === job) this.jobs.delete(row._id);
      return result;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Attempt>((resolve) => { timer = setTimeout(() => resolve('timeout'), Math.min(5_000, ttl)); });
    try { return await Promise.race([settled, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
