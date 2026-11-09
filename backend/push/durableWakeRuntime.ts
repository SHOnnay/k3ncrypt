import { maintenanceModeEnabled } from '../operations/maintenanceGate';
import type { Db } from 'mongodb';
import { DurableWakeStore, routeKey, wakeSchemaReady, type Slot } from './durableWakeStore';
import { registrationsForRoute, validWakeRoute } from './authenticatedWakeRoutes';
import { MongoPushStore, pushConfigured, type PushRow } from './privateWake';
import { WakeDispatcher } from './wakeDispatcher';

type Counters = Record<'enqueued' | 'overflow' | 'failed' | 'unavailable' | 'claims' | 'recycled' | 'gapScanned' | 'gapLimit' | 'expired' | 'exhausted', number>;
/** One bounded loop per Db/process. No startup migration, credentials, room admission or mailbox ACK. */
export class DurableWakeRuntime {
  readonly queue: DurableWakeStore;
  private readonly counts: Counters = { enqueued: 0, overflow: 0, failed: 0, unavailable: 0, claims: 0, recycled: 0, gapScanned: 0, gapLimit: 0, expired: 0, exhausted: 0 };
  private busy = false;
  private stopped = false;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private resolving = 0;
  private cycle?: () => Promise<void>;
  private cycling = false;
  private reconciled = false;
  constructor(private readonly db: Db, private readonly dispatcher: WakeDispatcher, private readonly allowed: () => boolean = () => pushConfigured() && !maintenanceModeEnabled()) { this.queue = new DurableWakeStore(db); }
  snapshot(): Readonly<Counters> { return { ...this.counts }; }
  private count(name: keyof Counters, n = 1): void { this.counts[name] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[name] + n); }
  async enqueuePersisted(room: unknown, recipient: unknown, id: unknown): Promise<void> {
    if (!this.allowed() || this.stopped || typeof room !== 'string' || typeof recipient !== 'string' || typeof id !== 'string') return;
    if (this.resolving >= 32) { this.count('overflow'); return; }
    this.resolving++;
    try {
      if (!await wakeSchemaReady(this.db)) { this.count('unavailable'); return; }
      const persisted = await this.db.collection('offline_messages').findOne({ id, channel: room, mailbox: recipient, state: 'active', timestamp: { $gte: Date.now() - 60_000, $lte: Date.now() }, expiresAt: { $gt: new Date() } }, { maxTimeMS: 2000, projection: { _id: 1 } });
      if (!persisted || !this.allowed()) return;
      const key = routeKey(room, recipient);
      for (const row of await registrationsForRoute(this.db, room, recipient)) {
        if (!await this.authorized(row, [key])) continue;
        if (await this.queue.enqueue(row, key)) { this.count('enqueued'); this.kick(); } else this.count('overflow');
      }
    } catch { this.count('failed'); }
    finally { this.resolving--; }
  }
  private async authorized(row: PushRow, keys: string[]): Promise<boolean> {
    if (!this.allowed() || this.stopped || !row.registrationVersion) return false;
    const store = new MongoPushStore(this.db);
    const active = await store.readActive(row.accountIdentityReference, row.deviceId);
    return !!active && active.state === 'active' && active.trustEpoch === row.trustEpoch && active.deviceIdentityReference === row.deviceIdentityReference && await store.isCurrent(row) && await validWakeRoute(this.db, row, keys) && this.allowed() && !this.stopped;
  }
  private async work(job: Slot): Promise<void> {
    try {
      const row = await this.db.collection<PushRow>('device_push_tokens_v1').findOne({ _id: job.registrationId!, registrationVersion: job.registrationVersion, trustEpoch: job.trustEpoch });
      if (!this.allowed() || this.stopped) return;
      if (!row || !await this.authorized(row, job.event!.routeKeys)) {
        if (this.allowed() && !this.stopped) await this.queue.finish(job, false);
        return;
      }
      const result = await this.dispatcher.dispatch(row, { data: this.queue.payload(job), authorized: () => this.authorized(row, job.event!.routeKeys), beforeSend: () => this.queue.beginAttempt(job), allowed: () => this.allowed() && !this.stopped });
      // Ambiguous timeout is terminal for this wave, preserving Phase A's no-overlap policy.
      if (!this.allowed() || this.stopped || result === 'deferred') return;
      await this.queue.finish(job, result === 'retry' || result === 'busy' || result === 'coalesced');
    } catch { this.count('failed'); /* Leave lease for bounded restart recovery, never touch mail. */ }
  }
  async runOnce(): Promise<void> {
    if (this.busy || this.stopped || !this.allowed()) return;
    this.busy = true;
    try {
      if (!await wakeSchemaReady(this.db)) { this.count('unavailable'); return; }
      const expired = await this.queue.expire();
      this.count('recycled', expired.expired + expired.exhausted); this.count('expired', expired.expired); this.count('exhausted', expired.exhausted);
      const work: Promise<void>[] = [];
      for (let i = 0; i < 16 && this.allowed() && !this.stopped; i++) {
        const job = await this.queue.claim(); if (!job) break;
        this.count('claims'); work.push(this.work(job));
      }
      await Promise.all(work);
    } catch { this.count('failed'); }
    finally { this.busy = false; }
  }
  /** Indexed, finite startup repair. It cannot promise to close every post-persistence crash gap. */
  async reconcileRecent(): Promise<void> {
    if (!this.allowed() || this.stopped || !await wakeSchemaReady(this.db)) return;
    this.reconciled = true;
    const began = Date.now(); let count = 0;
    const cursor = this.db.collection('offline_messages').find({ state: 'active', timestamp: { $gte: began - 60_000, $lte: began }, expiresAt: { $gt: new Date(began) } }, { maxTimeMS: 2000, projection: { id: 1, channel: 1, mailbox: 1 } }).sort({ timestamp: -1, _id: -1 }).hint('wake_reconcile_recent').limit(512).batchSize(32);
    try {
      for await (const row of cursor) {
        if (!this.allowed() || this.stopped || Date.now() - began >= 2000) { this.count('gapLimit'); break; }
        await this.enqueuePersisted(row.channel, row.mailbox, row.id); this.count('gapScanned'); count++;
      }
      if (count === 512) this.count('gapLimit');
    } catch { this.count('failed'); }
    finally { await cursor.close(); }
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const cycle = async () => {
      if (this.stopped || this.cycling) return;
      this.cycling = true;
      const claims = this.counts.claims; const recycled = this.counts.recycled;
      try {
        if (!this.reconciled && this.allowed()) await this.reconcileRecent();
        await this.runOnce();
      } catch { this.count('failed'); }
      finally {
        this.cycling = false;
        if (this.timer) clearTimeout(this.timer);
        if (!this.stopped) { this.timer = setTimeout(() => { this.timer = undefined; void cycle(); }, this.counts.claims === claims && this.counts.recycled === recycled ? 30_000 : 1000); this.timer.unref(); }
      }
    };
    this.cycle = cycle;
    void cycle();
  }

  private kick(): void {
    if (!this.started || this.stopped || this.busy || this.cycling || !this.cycle) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.cycle!(); }, 0); this.timer.unref();
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}
