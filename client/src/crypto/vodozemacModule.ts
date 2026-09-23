import init, { K3ncryptAccount, K3ncryptSession } from '@k3ncrypt-vodozemac';
import type { VodozemacBindings } from '@chat-e2ee/service';

let initialization: Promise<VodozemacBindings> | undefined;

/** Loads only the repository-local generated wasm-bindgen package. */
export const loadVodozemacBindings = (): Promise<VodozemacBindings> => {
    initialization ??= (async () => {
        await init();
        return {
            protocolVersion: 1 as const,
            accountFactory: {
                createAccount: () => wrapAccount(K3ncryptAccount.createAccount()),
                loadAccount: (pickle: string, key: Uint8Array) => wrapAccount(K3ncryptAccount.loadAccount(pickle, key)),
            },
            sessionFactory: {
                loadSession: (serialized: Uint8Array) => K3ncryptSession.loadSession(serialized),
            },
        };
    })();
    return initialization;
};

const wrapAccount = (account: K3ncryptAccount) => ({
    identityKeys: () => account.identityKeys(),
    signControlEvent: (payload: Uint8Array) => account.signControlEvent(payload),
    availableOneTimeKeys: () => JSON.parse(account.oneTimeKeys()),
    firstOneTimeKey: () => account.firstOneTimeKey(),
    fallbackKey: () => { try { return account.fallbackKey(); } catch { return undefined; } },
    generateOneTimeKeys: (count: number) => account.generateOneTimeKeys(count),
    generateFallbackKey: () => account.generateFallbackKey(),
    markKeysAsPublished: () => account.markKeysAsPublished(),
    saveAccount: (key: Uint8Array) => account.saveAccount(key),
    createOutboundSession: (identity: string, oneTimeKey: string) => account.createOutboundSession(identity.replace(/-/g, '+').replace(/_/g, '/'), oneTimeKey.replace(/-/g, '+').replace(/_/g, '/')),
    createInboundSession: (identity: string, message: string) => account.createInboundSession(identity.replace(/-/g, '+').replace(/_/g, '/'), message),
    inspectPublicStateForTest: () => {
        if ((globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ !== true) {
            throw new Error('Test-only Vodozemac diagnostics are disabled.');
        }
        return { identityKeys: account.identityKeys(), oneTimeKeys: JSON.parse(account.oneTimeKeys()), fallbackKey: (() => { try { return account.fallbackKey(); } catch { return undefined; } })() };
    },
    free: () => account.free(),
});
