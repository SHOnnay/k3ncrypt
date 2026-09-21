import type { DeviceSyncState, TransferState } from './contracts';

const deviceTransitions: Record<DeviceSyncState, readonly DeviceSyncState[]> = {
    pending: ['approved', 'suspended', 'revoked'], approved: ['syncing', 'suspended', 'revoked'], syncing: ['approved', 'suspended', 'revoked'], suspended: ['pending', 'approved', 'revoked'], revoked: [],
};
const transferTransitions: Record<TransferState, readonly TransferState[]> = {
    created: ['authorized', 'failed'], authorized: ['transferring', 'failed'], transferring: ['verified', 'failed'], verified: ['completed', 'failed'], completed: [], failed: [],
};
export const assertDeviceTransition = (from: DeviceSyncState, to: DeviceSyncState): void => { if (from !== to && !deviceTransitions[from].includes(to)) throw new Error('Invalid sync device transition.'); };
export const assertTransferTransition = (from: TransferState, to: TransferState): void => { if (from !== to && !transferTransitions[from].includes(to)) throw new Error('Invalid sync transfer transition.'); };
export class SyncStateMachine {
    public constructor(public device: DeviceSyncState = 'pending', public transfer: TransferState = 'created') {}
    public transitionDevice(next: DeviceSyncState): void { assertDeviceTransition(this.device, next); this.device = next; }
    public transitionTransfer(next: TransferState): void { assertTransferTransition(this.transfer, next); this.transfer = next; }
    public suspend(): void { if (this.device !== 'revoked') this.device = 'suspended'; if (!['completed','failed'].includes(this.transfer)) this.transfer = 'failed'; }
}
