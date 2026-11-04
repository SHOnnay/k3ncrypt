import { getRuntimeConfig } from '../config/runtimeConfig';
/**
 * Calls milestone 3: the optional connection helper. Off by default. When on, calls also ask a STUN server
 * for this device's public address, which helps two devices on different home networks find each other.
 * That server sees only the device's IP address, not who is called or anything said. The server list is
 * configurable at build time (CHATE2EE_CONNECTION_HELPER_ICE_SERVERS, same JSON as CHATE2EE_ICE_SERVERS), for
 * example a self-hosted coturn: [{"urls":"turn:pi.example:3478","username":"…","credential":"…"}].
 */
export const DEFAULT_CONNECTION_HELPER: readonly RTCIceServer[] = Object.freeze([{ urls: 'stun:stun.cloudflare.com:3478' }]);
export const CONNECTION_STALL_MS = 12_000;

export const callIceServers = (base: readonly RTCIceServer[], helperOn: boolean, helper: readonly RTCIceServer[] = DEFAULT_CONNECTION_HELPER): RTCIceServer[] =>
  helperOn ? [...base, ...helper] : [...base];

/** A call stuck on "Connecting" (or whose connection failed) with the helper off can offer to turn it on. */
export const connectionStalled = (state: string, connectingSince: number, now: number, helperOn: boolean): boolean =>
  !helperOn && (state === 'ice-failed' || (state === 'connecting' && now - connectingSince > CONNECTION_STALL_MS));

/** Names the helper's provider in plain words for Settings, from the configured server's host. */
export const connectionHelperProvider = (servers: readonly RTCIceServer[] = getRuntimeConfig().webrtc.connectionHelper): string => {
  const first = servers[0]?.urls; const url = Array.isArray(first) ? first[0] : first;
  const host = url?.replace(/^(stun|stuns|turn|turns):/i, '').split(/[:?]/)[0] ?? '';
  if (/cloudflare\.com$/i.test(host)) return 'Cloudflare';
  if (/google\.com$/i.test(host)) return 'Google';
  return host || 'not set';
};
