import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        define: {
            'process.env.CHATE2EE_API_URL': JSON.stringify(env.CHATE2EE_API_URL ?? ''),
            'process.env.CHATE2EE_ICE_SERVERS': JSON.stringify(env.CHATE2EE_ICE_SERVERS ?? ''),
            'process.env.CHATE2EE_ICE_TRANSPORT_POLICY': JSON.stringify(env.CHATE2EE_ICE_TRANSPORT_POLICY ?? ''),
            'process.env.CHATE2EE_ENABLE_DEBUG_LOGS': JSON.stringify(env.CHATE2EE_ENABLE_DEBUG_LOGS ?? ''),
        },
    };
});
