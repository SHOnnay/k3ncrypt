import type { DeviceProofOperation } from './deviceProofClient';
import type { DeviceProofCarrier, DeviceResourceContext } from './trustProtocol';

type Provider = { acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> };

const RESERVE_SIZE = 4;
/** A proof lives 30 s. Below this margin it could expire on its way to the relay. */
const MINIMUM_REMAINING_MS = 8_000;
const REFRESH_MS = 8_000;

/**
 * During a call, every signal needs a one-time proof, and fetching one takes over a second on production.
 * This holds a few unused proofs in memory for the current call, so ringing, candidates and hang-up don't wait.
 * Each proof is still one-time, short-lived, server-issued and server-verified; none is persisted or reused.
 */
export class SignalProofReserve implements Provider {
  private held: DeviceProofCarrier[] = [];
  private warmResource?: DeviceResourceContext;
  private inFlight = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly provider: Provider, private readonly now: () => number = Date.now) {}

  public async acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> {
    if (operation !== 'relay:signal' || !this.warmResource || JSON.stringify(resource) !== JSON.stringify(this.warmResource)) return this.provider.acquire(operation, resource);
    this.dropStale();
    const proof = this.held.shift();
    this.refill();
    return proof ?? this.provider.acquire(operation, resource);
  }

  /** Safe to call repeatedly while a call is active. */
  public warm(resource: DeviceResourceContext | undefined): void {
    if (!resource) return;
    if (JSON.stringify(resource) !== JSON.stringify(this.warmResource)) this.held = [];
    this.warmResource = resource;
    this.refill();
    if (!this.timer) {
      this.timer = setInterval(() => { this.dropStale(); this.refill(); }, REFRESH_MS);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  public cool(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.warmResource = undefined; this.held = [];
  }

  private dropStale(): void {
    this.held = this.held.filter((proof) => proof.deviceAuthorizationProof.expiresAt - this.now() > MINIMUM_REMAINING_MS);
  }

  private refill(): void {
    const resource = this.warmResource;
    if (!resource) return;
    for (let missing = RESERVE_SIZE - this.held.length - this.inFlight; missing > 0; missing -= 1) {
      this.inFlight += 1;
      void this.provider.acquire('relay:signal', resource)
        .then((proof) => { if (this.warmResource === resource) this.held.push(proof); })
        .catch(() => undefined) // Warming is best effort: acquire() falls back to a direct fetch.
        .finally(() => { this.inFlight -= 1; });
    }
  }
}
