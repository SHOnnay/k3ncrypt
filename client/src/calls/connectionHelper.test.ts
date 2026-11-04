import { CONNECTION_STALL_MS, DEFAULT_CONNECTION_HELPER, callIceServers, connectionHelperProvider, connectionStalled } from './connectionHelper';
import { defaultPrivacyPreferences } from '../product/preferences';

// Calls milestone 3: the connection helper is off by default and adds only the configured STUN/TURN servers.
describe('connection helper', () => {
  it('adds the helper servers only when on', () => {
    const base = [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }];
    expect(callIceServers(base, false)).toEqual(base);
    expect(callIceServers(base, true)).toEqual([...base, ...DEFAULT_CONNECTION_HELPER]);
    expect(callIceServers([], true, [{ urls: 'turn:pi.local:3478', username: 'k', credential: 's' }])).toEqual([{ urls: 'turn:pi.local:3478', username: 'k', credential: 's' }]);
    expect(DEFAULT_CONNECTION_HELPER).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
    expect(defaultPrivacyPreferences.connectionHelper).toBe(false);
  });

  it('names the provider in plain words', () => {
    expect(connectionHelperProvider(DEFAULT_CONNECTION_HELPER)).toBe('Cloudflare');
    expect(connectionHelperProvider([{ urls: ['stun:stun.l.google.com:19302'] }])).toBe('Google');
    expect(connectionHelperProvider([{ urls: 'turn:pi.home.example:3478?transport=udp' }])).toBe('pi.home.example');
  });

  it('calls a connection stalled only after the limit, while connecting, with the helper off', () => {
    expect(connectionStalled('connecting', 0, CONNECTION_STALL_MS + 1, false)).toBe(true);
    expect(connectionStalled('connecting', 0, CONNECTION_STALL_MS - 1, false)).toBe(false);
    expect(connectionStalled('connecting', 0, CONNECTION_STALL_MS + 1, true)).toBe(false);
    expect(connectionStalled('connected', 0, CONNECTION_STALL_MS + 1, false)).toBe(false);
    expect(connectionStalled('ice-failed', 0, 0, false)).toBe(true);
  });
});
