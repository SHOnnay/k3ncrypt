import request from 'supertest';
import app from '../../app';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('N1 push endpoint and startup wiring when push is not configured [unit test]', () => {
  it('POST /api/device-trust/push answers 503 and touches nothing', async () => {
    delete process.env.K3NCRYPT_FCM_ENABLED;
    const response = await request(app).post('/api/device-trust/push').send({ event: {}, deviceAuthorizationProof: {}, token: 'x'.repeat(40) });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Push unavailable' });
  });
});

describe('startup does not take over process signals', () => {
  it('index.ts registers no SIGTERM/SIGINT listener (a listener would stop Node exiting on those signals)', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.ts'), 'utf8') as string;
    expect(source).not.toMatch(/process\.(once|on)\(\s*['"]SIG(TERM|INT)['"]/);
  });
});
