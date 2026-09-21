import type { CryptoSession, EncryptedEnvelope } from '../core/contracts';
import type { AuthenticatedDeviceContext, AuthenticatedSenderIdentity } from './lifecycle';
import { decodeDeviceControl } from './runtime';

const contexts = new WeakMap<object, { session: CryptoSession; payload?: string }>();
/** Constructed only at the verified runtime composition root, never from a control payload. */
export class DeviceContextAuthority {
    public constructor(private readonly session: CryptoSession, private readonly conversationId: string,
        private readonly local: AuthenticatedSenderIdentity, private readonly remote?: AuthenticatedSenderIdentity) {}
    public localContext(): AuthenticatedDeviceContext { return this.issue(this.local); }
    public async receive(envelope: EncryptedEnvelope): Promise<{ context: AuthenticatedDeviceContext; payload: unknown }> {
        if (!this.remote || !this.session.ready || !this.session.encrypted) throw new Error('Authenticated device context unavailable.');
        const plaintext = await this.session.decrypt('signaling', envelope);
        const message = decodeDeviceControl(plaintext);
        if (!message || message.payload === undefined) throw new Error('Device control rejected.');
        return { context: this.issue(this.remote, JSON.stringify(message.payload)), payload: message.payload };
    }
    private issue(sender: AuthenticatedSenderIdentity, payload?: string): AuthenticatedDeviceContext {
        if (!this.session.ready || !this.session.encrypted || !sender.verified) throw new Error('Authenticated device context unavailable.');
        const context = Object.freeze({ cryptoSession: this.session, conversationId: this.conversationId, userScope: sender.userScope, authenticatedSender: Object.freeze({ ...sender }) });
        contexts.set(context, { session: this.session, payload });
        return context;
    }
}
export const assertIssuedDeviceContext = (context: AuthenticatedDeviceContext, payload?: unknown): void => {
    const proof = contexts.get(context);
    if (!proof || !proof.session.ready || !proof.session.encrypted || proof.session !== context.cryptoSession) throw new Error('Invalid authenticated device context.');
    if (proof.payload !== undefined && (payload === undefined || proof.payload !== JSON.stringify(payload))) throw new Error('Authenticated device payload mismatch.');
};
