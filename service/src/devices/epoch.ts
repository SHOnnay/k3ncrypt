import type { DeviceList } from './deviceIdentity';
import { createDeviceList } from './deviceList';

export type EpochValidation = 'current' | 'stale' | 'future';

export const compareEpoch = (current: number, candidate: number): EpochValidation => {
    if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(candidate) || candidate < 0) {
        throw new Error('Invalid device-list epoch.');
    }
    return candidate === current ? 'current' : candidate < current ? 'stale' : 'future';
};

export const assertNextEpoch = (previous: DeviceList, next: DeviceList): void => {
    const prior = createDeviceList(previous);
    const candidate = createDeviceList(next);
    if (candidate.identityReference !== prior.identityReference) throw new Error('Device-list identity scope changed.');
    if (candidate.epoch !== prior.epoch + 1) throw new Error('Device-list epoch must increase by one.');
    if (candidate.previousCommitment === null) throw new Error('Next device list requires a previous commitment.');
};

export const assertNotRollback = (current: DeviceList, candidate: DeviceList): void => {
    const currentList = createDeviceList(current);
    const candidateList = createDeviceList(candidate);
    if (candidateList.identityReference !== currentList.identityReference) throw new Error('Device-list identity scope changed.');
    if (candidateList.epoch < currentList.epoch) throw new Error('Device-list rollback rejected.');
};

export const assertCurrentEpoch = (current: DeviceList, candidateEpoch: number): void => {
    if (compareEpoch(createDeviceList(current).epoch, candidateEpoch) !== 'current') throw new Error('Stale device-list epoch.');
};
