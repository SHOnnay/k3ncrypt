import express from 'express';
import request from 'supertest';
import { HttpRateLimiter } from './httpRateLimiter';
import { apiRateLimit } from './apiRateLimit';
import { createControlRateLimit } from './controlRateLimit';

test('bounded bookkeeping denies churn without resetting existing limits, then reclaims idle buckets', () => {
  let now = 1000; const limiter = new HttpRateLimiter(1, 1, 2, 2000, () => now);
  expect(limiter.consume('a')).toBe(true); expect(limiter.consume('b')).toBe(true);
  for (let i = 0; i < 10000; i++) expect(limiter.consume(`new-${i}`)).toBe(false);
  expect(limiter.bucketCount).toBe(2); expect(limiter.consume('a')).toBe(false);
  now += 2001; expect(limiter.consume('new')).toBe(true); expect(limiter.bucketCount).toBe(1);
});
test('varying concrete transfer paths share one aggregate API budget', async () => {
  const app = express(); app.set('trust proxy', 1); app.use(apiRateLimit); app.get('/attachments/:id/chunks/:index', (_req, res) => res.sendStatus(200));
  // Keep one listener for this budget: repeated ephemeral servers can reuse
  // ports while Node's shared HTTP agent still retains a previous connection.
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try { for (let i = 0; i < 120; i++) await request(server).get(`/attachments/id-${i}/chunks/${i}`).set('X-Forwarded-For', '192.0.2.17').expect(200);
    await request(server).get('/attachments/another/chunks/0').set('X-Forwarded-For', '192.0.2.17').expect(429);
  } finally {
    jest.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
test('control limits also aggregate across concrete room IDs', async () => {
  const app = express(); app.get('/:id', createControlRateLimit(2, 0), (_req, res) => res.sendStatus(200));
  await request(app).get('/one').expect(200); await request(app).get('/two').expect(200); await request(app).get('/three').expect(429);
});
test('numeric single-hop proxy semantics preserve nearest forwarded client and ignore headers when proxy trust is disabled', async () => {
  const trusted = express(); trusted.set('trust proxy', 1); trusted.get('/', (req, res) => res.json({ ip: req.ip }));
  expect((await request(trusted).get('/').set('X-Forwarded-For', '192.0.2.99, 192.0.2.18')).body.ip).toBe('192.0.2.18');
  const untrusted = express(); untrusted.get('/', (req, res) => res.json({ spoofed: req.ip === '192.0.2.99' }));
  expect((await request(untrusted).get('/').set('X-Forwarded-For', '192.0.2.99')).body.spoofed).toBe(false);
});
