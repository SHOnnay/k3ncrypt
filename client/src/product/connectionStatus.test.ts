import { connectionStatus, connectionStatusCopy } from './connectionStatus';

describe('single chat header connection status', () => {
  it('reports one state and never claims the contact is online', () => {
    expect(connectionStatus(true, true)).toBe('connected');
    expect(connectionStatus(true, false)).toBe('connecting');
    expect(connectionStatus(false, true)).toBe('offline');
    expect(connectionStatusCopy('connected')).toEqual({ label: 'Connected' });
    expect(connectionStatusCopy('connecting')).toEqual({ label: 'Connecting…', help: 'Messages will send when connected.' });
    expect(connectionStatusCopy('offline')).toEqual({ label: 'You’re offline.', help: 'Messages will send when you’re back.' });
    for (const state of ['connected', 'connecting', 'offline'] as const) expect(JSON.stringify(connectionStatusCopy(state))).not.toMatch(/online/i);
  });
});
