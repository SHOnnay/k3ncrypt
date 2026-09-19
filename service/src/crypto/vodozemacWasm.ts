import { VodozemacBoundaryError } from './vodozemacErrors';
import type { VodozemacBindings } from './vodozemacRuntime';

/** Local generated-bindings module shape. No remote URL or downloader is accepted. */
export interface VodozemacGeneratedModule {
    default(input?: Response | ArrayBuffer | WebAssembly.Module): Promise<unknown>;
    bindings(): VodozemacBindings;
}

export const loadLocalVodozemacBindings = async (
    loadModule: () => Promise<VodozemacGeneratedModule>,
    wasmUrl: URL,
): Promise<VodozemacBindings> => {
    if (wasmUrl.protocol !== 'file:' && wasmUrl.protocol !== 'http:' && wasmUrl.protocol !== 'https:') {
        throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto module URL is invalid.');
    }
    // The caller owns the bundled URL; this function never constructs a remote fallback.
    try {
        const module = await loadModule();
        await module.default(fetch(wasmUrl));
        const bindings = module.bindings();
        if (bindings.protocolVersion !== 1) {
            throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Unsupported modern crypto protocol.');
        }
        return bindings;
    } catch (error) {
        if (error instanceof VodozemacBoundaryError) throw error;
        throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto is unavailable.');
    }
};
