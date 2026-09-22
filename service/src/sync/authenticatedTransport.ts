import type { CryptoSession, EncryptedEnvelope } from '../core/contracts';
import type { SyncPackage, SyncTrustBoundary } from './contracts';
import { decodeSyncPackage, encodeSyncPackage, verifyDeviceListCheckpoint } from './codec';
import { assertSyncEnvelopeSize, type SyncEnvelopeRelay } from './relay';

export interface SyncSessionBinding {
    readonly session: CryptoSession;
    readonly sessionBinding: string;
    readonly localIdentityReference: string;
    readonly peerIdentityReference: string;
    readonly peerDeviceId: string;
}

export interface AuthenticatedSyncFrame {
    readonly sessionBinding: string;
    readonly senderIdentityReference: string;
    readonly receiverIdentityReference: string;
    readonly senderDeviceId: string;
    readonly syncPackage: SyncPackage;
}
const issued = new WeakMap<object, CryptoSession>();
export const consumeAuthenticatedSyncFrame = (frame: AuthenticatedSyncFrame): void => {
    const session = frame && issued.get(frame);
    if (!session?.ready || !session.encrypted) throw new Error('Authenticated sync frame rejected or replayed.');
    issued.delete(frame);
};

/** Binds sync traffic to the already-authenticated conversation session. */
export class AuthenticatedSyncTransport {
    private readonly binding: SyncSessionBinding;
    public constructor(binding: SyncSessionBinding, private readonly transport: SyncEnvelopeRelay, private readonly scope: string, private readonly localDeviceId: string, private readonly trust: SyncTrustBoundary) { this.binding = Object.freeze({ ...binding }); }

    private async validateTrust(pkg: SyncPackage): Promise<void> {
        const state = await this.trust.snapshot();
        await verifyDeviceListCheckpoint(state.list, pkg.checkpoint);
        await this.trust.assertTrustedAt(pkg.checkpoint.epoch);
        for (const [deviceId, identity] of [[this.localDeviceId, this.binding.localIdentityReference], [this.binding.peerDeviceId, this.binding.peerIdentityReference]]) {
            if (!state.list.devices.some((entry) => entry.deviceId === deviceId && entry.publicIdentityReference === identity && entry.state === 'active')) throw new Error('Authenticated sync trust rejected.');
        }
    }

    public async send(pkg: SyncPackage): Promise<void> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || pkg.scope !== this.scope || pkg.sender !== this.localDeviceId || pkg.senderIdentity !== this.binding.localIdentityReference || pkg.receiverIdentity !== this.binding.peerIdentityReference || pkg.receiver !== this.binding.peerDeviceId) throw new Error('Authenticated sync origin rejected.');
        const encoded = encodeSyncPackage(pkg);
        decodeSyncPackage(encoded);
        await this.validateTrust(pkg);
        const envelope = await this.binding.session.encrypt('signaling', encoded);
        assertSyncEnvelopeSize(envelope);
        await this.validateTrust(pkg);
        await this.transport.send(envelope);
    }

    public async receive(envelope: EncryptedEnvelope, expectedPeerDeviceId: string): Promise<AuthenticatedSyncFrame> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || expectedPeerDeviceId !== this.binding.peerDeviceId) throw new Error('Authenticated sync session rejected.');
        if (!this.binding.sessionBinding) throw new Error('Authenticated sync session rejected.');
        assertSyncEnvelopeSize(envelope);
        const pkg = decodeSyncPackage(await this.binding.session.decrypt('signaling', envelope));
        const freeze = (value: unknown): void => {
            if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        };
        freeze(pkg);
        if (pkg.scope !== this.scope || pkg.senderIdentity !== this.binding.peerIdentityReference || pkg.receiverIdentity !== this.binding.localIdentityReference || pkg.receiver !== this.localDeviceId || pkg.sender !== this.binding.peerDeviceId) throw new Error('Authenticated sync identity rejected.');
        await this.validateTrust(pkg);
        const frame = Object.freeze({ sessionBinding: this.binding.sessionBinding, senderIdentityReference: this.binding.peerIdentityReference, receiverIdentityReference: this.binding.localIdentityReference, senderDeviceId: this.binding.peerDeviceId, syncPackage: pkg });
        issued.set(frame, this.binding.session);
        return frame;
    }
}
