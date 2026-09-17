import { configType, SetConfigType } from './public/types';
import { Logger } from './utils/logger';

let chate2eeConfig: configType = {
    settings: {
        disableLog: true
    },
    baseUrl: 'http://localhost:3001',
    webrtc: {
        iceServers: [],
        iceTransportPolicy: 'all',
    },
};

export const setConfig: SetConfigType = (config) => {
    const logger = new Logger('Config').withInvocationId();
    logger.log(`Overriding config`, config);
    chate2eeConfig = {
        ...chate2eeConfig,
        ...config,
        settings: { ...chate2eeConfig.settings, ...config.settings },
        webrtc: { ...chate2eeConfig.webrtc, ...config.webrtc },
    }
}

export const configContext = (): configType => chate2eeConfig;
