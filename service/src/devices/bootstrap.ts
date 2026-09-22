import makeRequest from '../api/client';
import type { ControlEventSigner, BootstrapRequest } from './trustProtocol';
import { signBootstrapRequest } from './trustProtocol';

export type BootstrapResult = { accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; trustEpoch: number };

/** Client-side first-device bootstrap. The private identity remains inside the signer boundary. */
export const bootstrapFirstDevice = async (signer: ControlEventSigner, input: { deviceId: string; deviceIdentityReference: string; verificationKey: string; fingerprint: string; now?: number }): Promise<BootstrapResult> => {
    const now = input.now ?? Date.now();
    const request: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: crypto.randomUUID(), deviceId: input.deviceId, deviceIdentityReference: input.deviceIdentityReference, verificationKey: input.verificationKey, fingerprint: input.fingerprint, createdAt: now, expiresAt: now + 30_000, nonce: crypto.randomUUID().replace(/-/g, '') };
    return makeRequest<BootstrapResult, BootstrapRequest>('device-trust/bootstrap', { method: 'POST', body: await signBootstrapRequest(signer, request) });
};
