import { getRuntimeConfig } from './runtimeConfig';

describe('getRuntimeConfig', () => {
  const original = { ...process.env };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  afterEach(() => {
    process.env = { ...original };
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('defaults to no external ICE servers and privacy-minimal logging', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CHATE2EE_ICE_SERVERS;
    delete process.env.CHATE2EE_ICE_TRANSPORT_POLICY;
    delete process.env.CHATE2EE_ENABLE_DEBUG_LOGS;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://app.example.test' } } });
    expect(getRuntimeConfig()).toEqual(expect.objectContaining({
      baseUrl: 'https://app.example.test',
      settings: { disableLog: true },
      webrtc: { iceServers: [], iceTransportPolicy: 'all' },
    }));
  });

  it('uses localhost defaults only in non-production builds', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CHATE2EE_API_URL;
    expect(getRuntimeConfig().baseUrl).toBe('http://localhost:3001');
    process.env.CHATE2EE_API_URL = 'https://api.example.test';
    expect(getRuntimeConfig().baseUrl).toBe('https://api.example.test');
  });

  it('accepts explicitly configured ICE servers and relay-only policy', () => {
    process.env.CHATE2EE_ICE_SERVERS = '[{"urls":"turn:turn.example.test"}]';
    process.env.CHATE2EE_ICE_TRANSPORT_POLICY = 'relay';
    expect(getRuntimeConfig().webrtc).toEqual({
      iceServers: [{ urls: 'turn:turn.example.test' }],
      iceTransportPolicy: 'relay',
    });
  });

  it('fails closed to an empty ICE list when JSON is malformed', () => {
    process.env.CHATE2EE_ICE_SERVERS = 'not-json';
    expect(getRuntimeConfig().webrtc?.iceServers).toEqual([]);
  });

  it('rejects invalid ICE URLs and malformed TURN credentials', () => {
    process.env.CHATE2EE_ICE_SERVERS = '[{"urls":"https://not-an-ice-server"},{"urls":"turn:relay.example.test","credential":4}]';
    expect(getRuntimeConfig().webrtc.iceServers).toEqual([]);
  });
});
