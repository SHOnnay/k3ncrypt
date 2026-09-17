import { getRuntimeConfig } from './runtimeConfig';

describe('getRuntimeConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults to no external ICE servers and privacy-minimal logging', () => {
    delete process.env.CHATE2EE_ICE_SERVERS;
    delete process.env.CHATE2EE_ICE_TRANSPORT_POLICY;
    delete process.env.CHATE2EE_ENABLE_DEBUG_LOGS;
    expect(getRuntimeConfig()).toEqual(expect.objectContaining({
      settings: { disableLog: true },
      webrtc: { iceServers: [], iceTransportPolicy: 'all' },
    }));
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
});

