import { deviceListCommitment } from './canonicalEncoding';
import type { DeviceLifecyclePersistence, LifecycleStateSnapshot } from './lifecycle';

export type DeviceTrustDecision = 'trusted' | 'revoked' | 'unavailable';

/** Single enforcement boundary shared by messaging, calls, attachments, and sync adapters. */
export class DeviceTrustEnforcer {
    public constructor(private readonly persistence: DeviceLifecyclePersistence, private readonly scope: string, private readonly deviceId: string, private readonly identityReference: string) {}

    public async snapshot(): Promise<LifecycleStateSnapshot> {
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
}
