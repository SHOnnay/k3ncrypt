import request from 'supertest';

jest.mock('../operations/status', () => ({
  healthStatus: () => ({ status: 'ok' }),
  readinessStatus: async () => ({ status: 'ready', dependencies: { database: 'ready', messagingRelay: 'ready', syncRelay: 'ready', privateNetworkRelay: 'ready' } }),
}));

import app from '../../app';

describe('operational endpoints', () => {
  it('keeps liveness and readiness distinct', async () => {
    await request(app).get('/api/health').expect(200, { status: 'ok' });
    await request(app).get('/api/ready').expect(200, { status: 'ready', dependencies: { database: 'ready', messagingRelay: 'ready', syncRelay: 'ready', privateNetworkRelay: 'ready' } });
  });
});
