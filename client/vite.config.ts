import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const localVodozemacAsset = () => ({
    name: 'k3ncrypt-local-vodozemac',
    generateBundle() {
        this.emitFile({
            type: 'asset',
            fileName: 'crypto/k3ncrypt_vodozemac_bg.wasm',
            source: readFileSync(fileURLToPath(new URL('../crypto-wasm/pkg/k3ncrypt_vodozemac_bg.wasm', import.meta.url))),
        });
    },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react(), localVodozemacAsset()],
        define: {
            'process.env.CHATE2EE_API_URL': JSON.stringify(env.CHATE2EE_API_URL ?? ''),
            'process.env.CHATE2EE_ICE_SERVERS': JSON.stringify(env.CHATE2EE_ICE_SERVERS ?? ''),
            'process.env.CHATE2EE_ICE_TRANSPORT_POLICY': JSON.stringify(env.CHATE2EE_ICE_TRANSPORT_POLICY ?? ''),
            'process.env.CHATE2EE_ENABLE_DEBUG_LOGS': JSON.stringify(env.CHATE2EE_ENABLE_DEBUG_LOGS ?? ''),
        },
    };
});
