import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { SyncPackage } from './contracts';

export interface SyncSessionBinding {
    readonly session: CryptoSession;
    readonly sessionBinding: string;
    readonly localIdentityReference: string;
    readonly peerIdentityReference: string;
    readonly peerDeviceId: string;
}

export interface AuthenticatedSyncFrame {
    readonly envelope: EncryptedEnvelope;
    readonly sessionBinding: string;
    readonly senderIdentityReference: string;
    readonly receiverIdentityReference: string;
    readonly senderDeviceId: string;
}

const encode = (value: SyncPackage): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer): SyncPackage => {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('Authenticated sync frame rejected.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Authenticated sync frame rejected.');
    return value as SyncPackage;
};

/** Binds sync traffic to the already-authenticated conversation session. */
export class AuthenticatedSyncTransport {
    public constructor(private readonly binding: SyncSessionBinding, private readonly transport: TransportManager, private readonly scope: string, private readonly localDeviceId: string) {}

    public async send(pkg: SyncPackage): Promise<void> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || pkg.scope !== this.scope || pkg.sender !== this.localDeviceId || pkg.senderIdentity !== this.binding.localIdentityReference || pkg.receiverIdentity !== this.binding.peerIdentityReference || pkg.receiver !== this.binding.peerDeviceId) throw new Error('Authenticated sync origin rejected.');
        await this.transport.sendEnvelope('signaling', await this.binding.session.encrypt('signaling', encode(pkg)), pkg.receiver);
    }

    public async receive(envelope: EncryptedEnvelope, expectedPeerDeviceId: string): Promise<AuthenticatedSyncFrame & { package: SyncPackage }> {
        if (!this.binding.session.ready || !this.binding.session.encrypted || expectedPeerDeviceId !== this.binding.peerDeviceId) throw new Error('Authenticated sync session rejected.');
        const pkg = decode(await this.binding.session.decrypt('signaling', envelope));
        if (pkg.scope !== this.scope || pkg.senderIdentity !== this.binding.peerIdentityReference || pkg.receiverIdentity !== this.binding.localIdentityReference || pkg.receiver !== this.localDeviceId || pkg.sender !== this.binding.peerDeviceId) throw new Error('Authenticated sync identity rejected.');
        return { envelope, package: pkg, sessionBinding: this.binding.sessionBinding, senderIdentityReference: this.binding.peerIdentityReference, receiverIdentityReference: this.binding.localIdentityReference, senderDeviceId: this.binding.peerDeviceId };
    }
}
