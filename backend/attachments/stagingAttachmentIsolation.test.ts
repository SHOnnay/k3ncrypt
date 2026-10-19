import express from 'express';
import { createFileRouter } from '../api/attachments/files';
const { allowStagingPath } = require('../../scripts/staging/attachmentPolicy.cjs');
const request = require('supertest');

test.each(['/api/attachments', '/api/attachments/create', '/API/ATTACHMENTS/create', '/api/attachments/v20/create', '/api/attachments/v2/../create', '/api/%61ttachments/create', '/api/attachments%2fv2/create', '/api/attachments/v2/%2e%2e/create', '/api/attachments/v2/%252e%252e/create', '/api/attachments\\v2/create', '//stage.invalid/api/attachments/create'])('staging-only boundary rejects ambiguous/legacy target %s', target => {
  expect(allowStagingPath(target)).toBe(false);
});

test.each(['/api/attachments/v2/create', '/api/attachments/v2/id/chunks/0', '/api/attachments/v2/id?synthetic=1', '/api/device-trust/proofs', '/socket.io/?EIO=4&transport=websocket'])('staging preserves canonical V2 and shared authority path %s', target => {
  expect(allowStagingPath(target)).toBe(true);
});

test('boundary blocks V1 before dispatch; V2 still requires its version and authenticated admission', async () => {
  let legacy = 0;
  const authenticate = jest.fn().mockResolvedValue(undefined), service = jest.fn();
  const app = express();
  app.use((req, res, next) => allowStagingPath(req.originalUrl) ? next() : void res.sendStatus(404));
  app.use('/api/attachments/v2', createFileRouter(authenticate, service));
  app.use('/api/attachments', (_req, res) => { legacy++; res.sendStatus(500); });
  expect((await request(app).post('/api/attachments/create')).status).toBe(404);
  expect(legacy).toBe(0);
  expect((await request(app).post('/api/attachments/v2/create')).status).toBe(400);
  expect(authenticate).not.toHaveBeenCalled();
  expect((await request(app).post('/api/attachments/v2/create').set('X-K3ncrypt-File-Version', '2')).status).toBe(403);
  expect(authenticate).toHaveBeenCalledTimes(1); expect(service).not.toHaveBeenCalled(); expect(legacy).toBe(0);
});
