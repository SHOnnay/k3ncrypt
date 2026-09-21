import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { SyncPackage } from './contracts';
import { decodeSyncPackage, encodeSyncPackage } from './codec';

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
    public constructor(binding: SyncSessionBinding, private readonly transport: TransportManager, private readonly scope: string, private readonly localDeviceId: string) { this.binding = Object.freeze({ ...binding }); }

    public async send(pkg: SyncPackage): Promise<void> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || pkg.scope !== this.scope || pkg.sender !== this.localDeviceId || pkg.senderIdentity !== this.binding.localIdentityReference || pkg.receiverIdentity !== this.binding.peerIdentityReference || pkg.receiver !== this.binding.peerDeviceId) throw new Error('Authenticated sync origin rejected.');
        const encoded = encodeSyncPackage(pkg);
        decodeSyncPackage(encoded);
        await this.transport.sendEnvelope('signaling', await this.binding.session.encrypt('signaling', encoded), pkg.receiver);
    }

    public async receive(envelope: EncryptedEnvelope, expectedPeerDeviceId: string): Promise<AuthenticatedSyncFrame> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || expectedPeerDeviceId !== this.binding.peerDeviceId) throw new Error('Authenticated sync session rejected.');
        if (!this.binding.sessionBinding) throw new Error('Authenticated sync session rejected.');
        const pkg = decodeSyncPackage(await this.binding.session.decrypt('signaling', envelope));
        const freeze = (value: unknown): void => {
            if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        };
        freeze(pkg);
        if (pkg.scope !== this.scope || pkg.senderIdentity !== this.binding.peerIdentityReference || pkg.receiverIdentity !== this.binding.localIdentityReference || pkg.receiver !== this.localDeviceId || pkg.sender !== this.binding.peerDeviceId) throw new Error('Authenticated sync identity rejected.');
        const frame = Object.freeze({ sessionBinding: this.binding.sessionBinding, senderIdentityReference: this.binding.peerIdentityReference, receiverIdentityReference: this.binding.localIdentityReference, senderDeviceId: this.binding.peerDeviceId, syncPackage: pkg });
        issued.set(frame, this.binding.session);
        return frame;
    }
}
