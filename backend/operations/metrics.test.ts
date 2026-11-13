import express from 'express';
import operations from '../api/operations';
import { countEvent, countJoinRejection, metricsAuthorized, metricsSnapshot, testOnlyResetMetrics } from './metrics';
const request = require('supertest');

const TOKEN = 'm'.repeat(40);
const app = () => { const value = express(); value.use('/api', operations); return value; };
const saved = process.env.K3NCRYPT_METRICS_TOKEN;
afterEach(() => { if (saved === undefined) delete process.env.K3NCRYPT_METRICS_TOKEN; else process.env.K3NCRYPT_METRICS_TOKEN = saved; testOnlyResetMetrics(); });

test('metrics are off without a token, and a wrong or short token looks like a missing page', async () => {
  delete process.env.K3NCRYPT_METRICS_TOKEN;
  await request(app()).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(404);
  process.env.K3NCRYPT_METRICS_TOKEN = 'short';
  await request(app()).get('/api/metrics').set('Authorization', 'Bearer short').expect(404);
  process.env.K3NCRYPT_METRICS_TOKEN = TOKEN;
  await request(app()).get('/api/metrics').expect(404);
  await request(app()).get('/api/metrics').set('Authorization', `Bearer ${'x'.repeat(40)}`).expect(404);
  expect(metricsAuthorized(`Bearer ${TOKEN}`)).toBe(true);
  expect(metricsAuthorized(TOKEN)).toBe(false);
});

test('the snapshot holds only fixed counter names and numbers: no identifiers can enter it', async () => {
  process.env.K3NCRYPT_METRICS_TOKEN = TOKEN;
  countEvent('envelope_stored'); countEvent('envelope_stored'); countEvent('contact_removed');
  countJoinRejection('device-proof');
  countJoinRejection('0b6f2a54-3c1d-4e8a-9f10-2a3b4c5d6e7f'); // an attacker-chosen "code" is not a counter
  const response = await request(app()).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.events).toMatchObject({ envelope_stored: 2, contact_removed: 1, 'join_rejected_device-proof': 1, envelope_refused: 0 });
  expect(Object.keys(response.body).sort()).toEqual(['events', 'storage', 'uptimeSeconds', 'wake']);
  const text = JSON.stringify(await metricsSnapshot());
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  const leaves = (value: unknown): unknown[] => value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value];
  expect(leaves(response.body).every((leaf) => leaf === null || typeof leaf === 'number')).toBe(true);
});
