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
    return Array.isArray(parsed) ? parsed as RTCIceServer[] : [];
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
