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
                createAccount: () => K3ncryptAccount.createAccount(),
                loadAccount: (pickle: string, key: Uint8Array) => K3ncryptAccount.loadAccount(pickle, key),
            },
            sessionFactory: {
                loadSession: (serialized: Uint8Array) => K3ncryptSession.loadSession(serialized),
            },
        };
    })();
    return initialization;
};
