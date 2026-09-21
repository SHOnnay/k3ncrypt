import type { EncryptedEnvelope } from '../core/contracts';
import type { SyncPackage } from './contracts';
import type { AuthenticatedSyncTransport } from './authenticatedTransport';
import { RuntimeSyncController } from './runtime';
import type { SyncEventDelivery } from './stateRecords';

const encode = (envelope: EncryptedEnvelope): ArrayBuffer => new TextEncoder().encode(JSON.stringify(envelope)).buffer as ArrayBuffer;
const decode = (frame: ArrayBuffer): EncryptedEnvelope => {
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(frame));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const envelope = value as Partial<EncryptedEnvelope>;
        if (typeof envelope.version !== 'number' || typeof envelope.strategy !== 'string' || typeof envelope.data !== 'object' || envelope.data === null) throw new Error();
        return envelope as EncryptedEnvelope;
    } catch { throw new Error('Authenticated sync delivery rejected.'); }
};

/** The modern-only runtime composition for inbound authenticated sync delivery. */
export class RuntimeSyncSession {
    private unsubscribe?: () => void;
    public constructor(private readonly scope: string, private readonly transport: AuthenticatedSyncTransport, private readonly controller: RuntimeSyncController, private readonly delivery: SyncEventDelivery) {}

    public start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.delivery.subscribe(this.scope, async (frame, senderDeviceId) => {
            const authenticated = await this.transport.receive(decode(frame), senderDeviceId);
            await this.controller.receiveAuthenticated(authenticated);
        });
    }

    public stop(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }

    public async send(envelope: EncryptedEnvelope, recipientDeviceId: string): Promise<void> {
        await this.delivery.publish(this.scope, encode(envelope), recipientDeviceId);
    }

    public async sendPackage(pkg: SyncPackage): Promise<void> {
        await this.transport.send(pkg);
    }
}
