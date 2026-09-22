import type { LifecycleStateSnapshot } from './lifecycle';

export interface TrustFreshnessEvidence {
    readonly version: 1;
    readonly deviceId: string;
    readonly identityReference: string;
    readonly epoch: number;
    readonly commitment: string;
    readonly evidenceId: string;
}

/**
 * Admission gate for distributed operations. Evidence is accepted only from
 * the authenticated device frame that carried it; this class deliberately
 * does not create or persist trust state.
 */
export class TrustFreshnessAdmission {
    private readonly evidence = new Map<string, TrustFreshnessEvidence>();
    public constructor(private readonly localDeviceId: string, private readonly maxMembers = 8) {}

    public recordAuthenticatedEvidence(evidence: TrustFreshnessEvidence, state: LifecycleStateSnapshot): void {
        if (evidence.version !== 1 || !evidence.deviceId || !evidence.identityReference || !evidence.evidenceId || !Number.isSafeInteger(evidence.epoch) || evidence.epoch < 0 || !/^[0-9a-f]{64}$/.test(evidence.commitment)) throw new Error('Trust freshness evidence rejected.');
        const device = state.list.devices.find((candidate) => candidate.deviceId === evidence.deviceId);
        if (!device || device.state !== 'active' || device.publicIdentityReference !== evidence.identityReference) throw new Error('Trust freshness evidence rejected.');
        if (evidence.epoch !== state.list.epoch || evidence.commitment !== state.commitment) throw new Error('Trust freshness evidence is stale.');
        const prior = this.evidence.get(evidence.deviceId);
        if (prior && (prior.evidenceId !== evidence.evidenceId || prior.commitment !== evidence.commitment)) throw new Error('Trust freshness evidence conflicts.');
        this.evidence.set(evidence.deviceId, Object.freeze({ ...evidence }));
        if (this.evidence.size > this.maxMembers) throw new Error('Trust freshness evidence unavailable.');
    }

    public assertCurrent(state: LifecycleStateSnapshot, members: readonly string[]): void {
        if (members.length === 0 || members.length > this.maxMembers || new Set(members).size !== members.length) throw new Error('Trust freshness membership rejected.');
        for (const deviceId of members) {
            const entry = state.list.devices.find((candidate) => candidate.deviceId === deviceId && candidate.state === 'active');
            if (!entry) throw new Error('Trust freshness membership rejected.');
            if (deviceId === this.localDeviceId) continue;
            const evidence = this.evidence.get(deviceId);
            if (!evidence || evidence.identityReference !== entry.publicIdentityReference || evidence.epoch !== state.list.epoch || evidence.commitment !== state.commitment) throw new Error('Trust freshness is unavailable.');
        }
    }

    public clear(): void { this.evidence.clear(); }
}
