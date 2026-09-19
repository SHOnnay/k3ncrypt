import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@k3ncrypt-vodozemac': fileURLToPath(new URL('../crypto-wasm/pkg/k3ncrypt_vodozemac.js', import.meta.url)),
            },
        },
        define: {
            'process.env.CHATE2EE_API_URL': JSON.stringify(env.CHATE2EE_API_URL ?? ''),
            'process.env.CHATE2EE_ICE_SERVERS': JSON.stringify(env.CHATE2EE_ICE_SERVERS ?? ''),
            'process.env.CHATE2EE_ICE_TRANSPORT_POLICY': JSON.stringify(env.CHATE2EE_ICE_TRANSPORT_POLICY ?? ''),
            'process.env.CHATE2EE_ENABLE_DEBUG_LOGS': JSON.stringify(env.CHATE2EE_ENABLE_DEBUG_LOGS ?? ''),
        },
    };
});
