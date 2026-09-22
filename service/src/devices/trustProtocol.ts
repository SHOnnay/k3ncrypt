/** Canonical, signed inputs for the durable device-trust authority. */
export type EnrollmentEvent = { version: 1; eventId: string; accountIdentityReference: string; issuerDeviceId: string; issuerIdentityReference: string; issuerEpoch: number; targetDeviceId: string; targetIdentityReference: string; targetVerificationKey: string; targetFingerprint: string; nonce: string; createdAt: number; expiresAt: number; signature: string };
export type DeviceResourceContext = { conversationId?: string; networkId?: string; attachmentId?: string; bridgeRouteId?: string };
export type NetworkMembershipOperation = 'add-member' | 'remove-member' | 'update-capability';
export type NetworkMembershipEvent = { version: 1; eventId: string; networkId: string; accountIdentityReference: string; issuerDeviceId: string; issuerIdentityReference: string; targetDeviceId: string; targetIdentityReference: string; operation: NetworkMembershipOperation; previousEpoch: number; nextEpoch: number; capabilities: readonly string[]; createdAt: number; expiresAt: number; nonce: string; signature: string };
export type DeviceProofRequest = { version: 1; requestId: string; accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; operation: string; nonce: string; epoch: number; resource?: DeviceResourceContext; createdAt: number; expiresAt: number; signature: string };
export type BootstrapRequest = { version: 1; requestId: string; deviceId: string; deviceIdentityReference: string; verificationKey: string; fingerprint: string; createdAt: number; expiresAt: number; nonce: string; signature: string };
/** Opaque server-issued authorization carried alongside encrypted transport data. */
export type DeviceAuthorizationProof = { version: 1; proofId: string; accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; operation: string; trustEpoch: number; nonce: string; resource?: DeviceResourceContext; issuedAt: number; expiresAt: number; signature: string };
export type DeviceProofCarrier = { deviceAuthorizationProof: DeviceAuthorizationProof; proofNonce: string };
export type ControlEventSigner = { signControlEvent(payload: Uint8Array): Promise<string> };
const canonical = (value: Record<string, unknown>): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const unsigned = <T extends { signature: string }>(value: T): Omit<T, 'signature'> => { const { signature: _signature, ...rest } = value; return rest; };

export const signEnrollmentEvent = async (signer: ControlEventSigner, event: Omit<EnrollmentEvent, 'signature'>): Promise<EnrollmentEvent> => ({ ...event, signature: await signer.signControlEvent(canonical(event)) });
export const signDeviceProofRequest = async (signer: ControlEventSigner, request: Omit<DeviceProofRequest, 'signature'>): Promise<DeviceProofRequest> => ({ ...request, signature: await signer.signControlEvent(canonical(request)) });
export const signBootstrapRequest = async (signer: ControlEventSigner, request: Omit<BootstrapRequest, 'signature'>): Promise<BootstrapRequest> => ({ ...request, signature: await signer.signControlEvent(canonical(request)) });
export const signNetworkMembershipEvent = async (signer: ControlEventSigner, event: Omit<NetworkMembershipEvent, 'signature'>): Promise<NetworkMembershipEvent> => ({ ...event, signature: await signer.signControlEvent(canonical(event)) });
export const lifecycleControlBytes = (value: EnrollmentEvent | DeviceProofRequest): Uint8Array => canonical(unsigned(value));
