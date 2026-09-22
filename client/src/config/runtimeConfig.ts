export interface ClientRuntimeConfig {
  baseUrl: string;
  settings: { disableLog: boolean };
  webrtc: {
    iceServers: RTCIceServer[];
    iceTransportPolicy: RTCIceTransportPolicy;
  };
}

const parseIceServers = (raw: string | undefined): RTCIceServer[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is RTCIceServer => {
      if (!value || typeof value !== 'object') return false;
      const server = value as { urls?: unknown; username?: unknown; credential?: unknown };
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.length > 0 && urls.every((url) => typeof url === 'string' && /^(stun|stuns|turn|turns):/i.test(url)) &&
        (server.username === undefined || typeof server.username === 'string') && (server.credential === undefined || typeof server.credential === 'string');
    });
  } catch {
    return [];
  }
};

const parseIcePolicy = (raw: string | undefined): RTCIceTransportPolicy =>
  raw === 'relay' ? 'relay' : 'all';

export const getRuntimeConfig = (): ClientRuntimeConfig => {
  const webrtc: ClientRuntimeConfig['webrtc'] = {
    iceServers: parseIceServers(process.env.CHATE2EE_ICE_SERVERS),
    iceTransportPolicy: parseIcePolicy(process.env.CHATE2EE_ICE_TRANSPORT_POLICY),
  };

  return {
    baseUrl: process.env.CHATE2EE_API_URL || 'http://localhost:3001',
    settings: {
      disableLog: process.env.CHATE2EE_ENABLE_DEBUG_LOGS !== 'true',
    },
    webrtc,
  };
};
