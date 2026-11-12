import { revokeRoutingOwnership } from '../api/prekeys';
import type { SecureStorage } from '../core/contracts';
import { DeviceProofClient } from '../devices/deviceProofClient';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { DeviceTrustEnforcer } from '../devices/trust';
import { loadAccountBinding } from '../identity/accountBinding';
import type { ContactRemovalRequest } from './modernConversation';
import { VodozemacRuntime, type VodozemacBindingsLoader } from './vodozemacRuntime';

/**
 * Tells the relay that this device has left a room, using only the unlocked vault: it must work after the chat's own
 * records have been deleted and after a restart, so a durable outbox can retry it. It never creates an identity or a
 * device binding. Resolves 'gone' when the room no longer exists; throws (with `status` when the relay answered) otherwise.
 */
export const revokeContactRoute = async (storage: SecureStorage, loader: VodozemacBindingsLoader, request: ContactRemovalRequest): Promise<'revoked' | 'gone'> => {
    if (!await storage.read('device-account-binding', 'local')) throw new Error('Device trust is unavailable.');
    const runtime = new VodozemacRuntime(storage, loader);
    try {
        await runtime.initialize();
        const own = await runtime.restoreOrCreateIdentity();
        const binding = await loadAccountBinding(storage, own.identityId);
        const trust = new DeviceTrustEnforcer(new SecureStorageDeviceLifecyclePersistence(storage), binding.userScope, binding.deviceId, own.identityId);
        const epoch = (await trust.snapshot()).list.epoch;
        await trust.assertTrustedAt(epoch);
        const proofs = new DeviceProofClient({ signControlEvent: (payload) => runtime.signControlEvent(payload) },
            async () => ({ accountIdentityReference: binding.userScope, deviceId: binding.deviceId, deviceIdentityReference: own.identityId, epoch }));
        const carrier = await proofs.acquire('device-control', { conversationId: request.roomId });
        try {
            await revokeRoutingOwnership(request.roomId, request.controlCapability, request.address, { participant: request.address, routingProof: request.routingProof, carrier });
            return 'revoked';
        } catch (error) {
            if ((error as { status?: number })?.status === 410) return 'gone';
            throw error;
        }
    } finally { runtime.close(); }
};
