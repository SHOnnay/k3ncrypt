import { deviceListCommitment } from './canonicalEncoding';
import type { DeviceLifecyclePersistence, LifecycleStateSnapshot } from './lifecycle';
import { TrustFreshnessAdmission, type TrustFreshnessEvidence } from './freshness';

export type DeviceTrustDecision = 'trusted' | 'revoked' | 'unavailable';

export type TrustState = 'active' | 'revoked';

/** Authenticated, monotonic notification emitted when the lifecycle epoch changes. */
export interface TrustStateEvent {
    readonly version: 1;
    readonly eventId: string;
    readonly scope: string;
    readonly epoch: number;
    readonly commitment: string;
    readonly deviceId: string;
    readonly identityReference: string;
    readonly state: TrustState;
    readonly createdAt: number;
}

export interface TrustStateEventSink {
    publish(event: TrustStateEvent): Promise<void>;
}

/** Single enforcement boundary shared by messaging, calls, attachments, and sync adapters. */
export class DeviceTrustEnforcer {
    private suspended = false;
    private freshnessMembers?: readonly string[];
    private readonly freshness: TrustFreshnessAdmission;
    public async suspend(epoch: number, commitment: string): Promise<void> {
        this.suspended = true;
        if (!this.persistence.suspendTrust) throw new Error('Durable trust suspension is unavailable.');
        await this.persistence.suspendTrust(this.scope, epoch, commitment);
    }
    public constructor(private readonly persistence: DeviceLifecyclePersistence, private readonly scope: string, private readonly deviceId: string, private readonly identityReference: string) { this.freshness = new TrustFreshnessAdmission(deviceId); }

    public configureFreshnessMembers(members: readonly string[]): void { this.freshnessMembers = Object.freeze([...members]); }
    public async recordFreshnessEvidence(evidence: TrustFreshnessEvidence): Promise<void> { this.freshness.recordAuthenticatedEvidence(evidence, await this.snapshot()); }

    public async snapshot(): Promise<LifecycleStateSnapshot> {
        if (this.suspended) throw new Error('Device trust is unavailable: freshness conflicts.');
        const state = await this.persistence.read(this.scope);
        if (!state) throw new Error('Device trust is unavailable.');
        if (await deviceListCommitment(state.list) !== state.commitment) throw new Error('Device trust state is corrupted.');
        return state;
    }

    public async decision(): Promise<DeviceTrustDecision> {
        try {
            const state = await this.snapshot();
            const device = state.list.devices.find((entry) => entry.deviceId === this.deviceId);
            if (!device || device.publicIdentityReference !== this.identityReference) return 'unavailable';
            return device.state === 'active' ? 'trusted' : device.state === 'revoked' ? 'revoked' : 'unavailable';
        } catch { return 'unavailable'; }
    }

    public async assertTrusted(): Promise<void> {
        if (await this.decision() !== 'trusted') throw new Error('Device trust is unavailable.');
    }

    /** Require the caller to operate on the exact lifecycle epoch it observed. */
    public async assertTrustedAt(epoch: number): Promise<void> {
        const state = await this.snapshot();
        if (state.list.epoch !== epoch) throw new Error('Device trust is stale.');
        if (this.freshnessMembers) this.freshness.assertCurrent(state, this.freshnessMembers);
        const entry = state.list.devices.find((candidate) => candidate.deviceId === this.deviceId);
        if (!entry || entry.publicIdentityReference !== this.identityReference || entry.state !== 'active') {
            throw new Error('Device trust is unavailable.');
        }
    }
}

/**
 * Validates lifecycle notifications at the application boundary. Notifications
 * never create trust: the durable lifecycle state remains authoritative. A
 * stale, future, forked, replayed, or mismatched event is rejected fail-closed.
 */
export class TrustStateEventCoordinator {
    private readonly seen = new Set<string>();
    public constructor(private readonly enforcer: DeviceTrustEnforcer, private readonly scope: string, private readonly maxSeen = 1024) {}

    public async accept(event: TrustStateEvent): Promise<LifecycleStateSnapshot> {
        if (event.version !== 1 || event.scope !== this.scope || !event.eventId || !Number.isSafeInteger(event.epoch) || event.epoch < 0 ||
            !Number.isSafeInteger(event.createdAt) || !/^[0-9a-f]{64}$/.test(event.commitment) || !event.deviceId || !event.identityReference ||
            (event.state !== 'active' && event.state !== 'revoked')) throw new Error('Trust state event is invalid.');
        if (this.seen.has(event.eventId)) throw new Error('Trust state event replayed.');
        const current = await this.enforcer.snapshot();
        if (event.epoch < current.list.epoch) throw new Error('Trust state event is stale.');
        if (event.epoch > current.list.epoch) { await this.enforcer.suspend(event.epoch, event.commitment); throw new Error('Trust state event is unavailable.'); }
        if (event.commitment !== current.commitment) { await this.enforcer.suspend(event.epoch, event.commitment); throw new Error('Trust state event conflicts with current state.'); }
        const entry = current.list.devices.find((candidate) => candidate.deviceId === event.deviceId);
        if (!entry || entry.publicIdentityReference !== event.identityReference || entry.state !== event.state) throw new Error('Trust state event does not match current state.');
        this.seen.add(event.eventId);
        if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value!);
        return current;
    }
}
