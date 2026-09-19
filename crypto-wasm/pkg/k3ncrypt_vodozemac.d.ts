/* tslint:disable */
/* eslint-disable */

export class InboundSessionResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    plaintext(): Uint8Array;
    takeSession(): K3ncryptSession;
}

export class K3ncryptAccount {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static createAccount(): K3ncryptAccount;
    createInboundSession(sender_identity_key: string, pre_key_message: string): InboundSessionResult;
    createOutboundSession(recipient_identity_key: string, recipient_one_time_key: string): K3ncryptSession;
    fallbackKey(): string;
    firstOneTimeKey(): string;
    generateFallbackKey(): void;
    generateOneTimeKeys(count: number): void;
    identityKeys(): string;
    static loadAccount(encrypted_pickle: string, pickle_key: Uint8Array): K3ncryptAccount;
    markKeysAsPublished(): void;
    oneTimeKeys(): string;
    saveAccount(pickle_key: Uint8Array): string;
}

export class K3ncryptSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    decrypt(wire_message: string): Uint8Array;
    encrypt(plaintext: Uint8Array): string;
    static loadSession(serialized: Uint8Array): K3ncryptSession;
    /**
     * Returns a transient modern SessionPickle encoding. JavaScript must
     * immediately pass it to K3ncrypt SecureStorage and drop the copy.
     */
    saveSession(): Uint8Array;
    sessionId(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_inboundsessionresult_free: (a: number, b: number) => void;
    readonly __wbg_k3ncryptaccount_free: (a: number, b: number) => void;
    readonly __wbg_k3ncryptsession_free: (a: number, b: number) => void;
    readonly inboundsessionresult_plaintext: (a: number) => [number, number];
    readonly inboundsessionresult_takeSession: (a: number) => [number, number, number];
    readonly k3ncryptaccount_createAccount: () => number;
    readonly k3ncryptaccount_createInboundSession: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly k3ncryptaccount_createOutboundSession: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly k3ncryptaccount_fallbackKey: (a: number) => [number, number, number, number];
    readonly k3ncryptaccount_firstOneTimeKey: (a: number) => [number, number, number, number];
    readonly k3ncryptaccount_generateFallbackKey: (a: number) => void;
    readonly k3ncryptaccount_generateOneTimeKeys: (a: number, b: number) => [number, number];
    readonly k3ncryptaccount_identityKeys: (a: number) => [number, number, number, number];
    readonly k3ncryptaccount_loadAccount: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly k3ncryptaccount_markKeysAsPublished: (a: number) => void;
    readonly k3ncryptaccount_oneTimeKeys: (a: number) => [number, number, number, number];
    readonly k3ncryptaccount_saveAccount: (a: number, b: number, c: number) => [number, number, number, number];
    readonly k3ncryptsession_decrypt: (a: number, b: number, c: number) => [number, number, number, number];
    readonly k3ncryptsession_encrypt: (a: number, b: number, c: number) => [number, number, number, number];
    readonly k3ncryptsession_loadSession: (a: number, b: number) => [number, number, number];
    readonly k3ncryptsession_saveSession: (a: number) => [number, number, number, number];
    readonly k3ncryptsession_sessionId: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
