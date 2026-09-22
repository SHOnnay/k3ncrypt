import makeRequest from '../api/client';
import { signDeviceProofRequest, type ControlEventSigner, type DeviceAuthorizationProof, type DeviceProofCarrier, type DeviceProofRequest, type DeviceResourceContext } from './trustProtocol';

export type DeviceProofOperation = 'relay:message' | 'relay:signal' | 'attachment:create' | 'attachment:write' | 'attachment:read' | 'attachment:delete' | 'private-network:relay' | 'bridge:authorize' | 'device-control';
export type DeviceProofIdentity = { accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; epoch: number };

const nonce = (): string => crypto.randomUUID().replace(/-/g, '');

/** Obtains a new, short-lived proof for each protected operation. Proofs are never persisted or reused. */
export class DeviceProofClient {
    constructor(private readonly signer: ControlEventSigner, private readonly identity: () => Promise<DeviceProofIdentity>, private readonly now: () => number = Date.now) {}

    public async acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> {
        const current = await this.identity(); const createdAt = this.now(); const proofNonce = nonce();
        const request: Omit<DeviceProofRequest, 'signature'> = {
            version: 1, requestId: crypto.randomUUID(), accountIdentityReference: current.accountIdentityReference,
            deviceId: current.deviceId, deviceIdentityReference: current.deviceIdentityReference, operation,
            nonce: proofNonce, epoch: current.epoch, ...(resource ? { resource } : {}), createdAt, expiresAt: createdAt + 30_000,
        };
        const signed = await signDeviceProofRequest(this.signer, request);
        const proof = await makeRequest<DeviceAuthorizationProof, DeviceProofRequest>('device-trust/proof', { method: 'POST', body: signed });
        if (proof.operation !== operation || proof.nonce !== proofNonce || proof.expiresAt <= this.now()) throw new Error('Device proof rejected.');
        return { deviceAuthorizationProof: proof, proofNonce };
    }
}
