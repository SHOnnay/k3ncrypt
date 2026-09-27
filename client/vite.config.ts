import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const validateProductionApiOrigin = (raw: string): void => {
    if (!raw.trim()) return; // Same-origin API is the supported default.
    let url: URL;
    try { url = new URL(raw.trim()); } catch { throw new Error('Production CHATE2EE_API_URL must be an HTTPS origin.'); }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const placeholder = host === 'localhost' || host === 'example.com' || host.endsWith('.example.com') ||
        host.endsWith('.example') || host.endsWith('.test') || host.endsWith('.invalid') || host === '10.0.2.2' || host === '127.0.0.1';
    if (url.protocol !== 'https:' || !url.host || url.username || url.password || url.pathname !== '/' || url.search || url.hash || placeholder) {
        throw new Error('Production CHATE2EE_API_URL must be a real HTTPS origin.');
    }
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    if (mode === 'production') validateProductionApiOrigin(env.CHATE2EE_API_URL ?? '');
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@k3ncrypt-vodozemac': fileURLToPath(new URL('../crypto-wasm/pkg/k3ncrypt_vodozemac.js', import.meta.url)),
            },
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
            'process.env.CHATE2EE_API_URL': JSON.stringify(env.CHATE2EE_API_URL ?? ''),
            'process.env.CHATE2EE_ICE_SERVERS': JSON.stringify(env.CHATE2EE_ICE_SERVERS ?? ''),
            'process.env.CHATE2EE_ICE_TRANSPORT_POLICY': JSON.stringify(env.CHATE2EE_ICE_TRANSPORT_POLICY ?? ''),
            'process.env.CHATE2EE_ENABLE_DEBUG_LOGS': JSON.stringify(env.CHATE2EE_ENABLE_DEBUG_LOGS ?? ''),
        },
    };
});
