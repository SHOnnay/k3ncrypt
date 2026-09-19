/** Stable, non-sensitive failure codes for the modern crypto boundary. */
export type VodozemacErrorCode =
    | 'WASM_INIT_FAILED'
    | 'CORRUPTED_ACCOUNT'
    | 'CORRUPTED_SESSION'
    | 'UNSUPPORTED_PROTOCOL'
    | 'INVALID_CIPHERTEXT'
    | 'MISSING_SESSION'
    | 'IDENTITY_MISMATCH'
    | 'INVALID_LIFECYCLE';

/** Errors crossing this boundary never include keys, ciphertext, pickles, or plaintext. */
export class VodozemacBoundaryError extends Error {
    public readonly name = 'VodozemacBoundaryError';

    constructor(public readonly code: VodozemacErrorCode, message: string) {
        super(message);
    }
}
