import { randomBytes } from 'crypto';
import request from 'supertest';

import app from '../../app';
import { hashControlCapability } from '../security/controlCapability';

const header = 'X-K3ncrypt-Control-Capability';

describe('capability-authorized room control plane', () => {
  it('rejects malformed room creation verifiers and unknown request fields', async () => {
    await request(app).post('/api/chat-link').send({ controlCapabilityHash: 'short' }).expect(400);
    await request(app).post('/api/chat-link').send({ controlCapabilityHash: 'a'.repeat(64), unexpected: true }).expect(400);
  });

  it('prevents unauthorized status, presence, and deletion while allowing the capability holder', async () => {
    const capability = randomBytes(32).toString('base64url');
    const wrongCapability = randomBytes(32).toString('base64url');
    const created = await request(app)
      .post('/api/chat-link')
      .send({ controlCapabilityHash: hashControlCapability(capability) })
      .expect(200);
    const roomId = created.body.hash as string;

    await request(app).get(`/api/chat-link/status/${roomId}`).expect(400);
    await request(app).get(`/api/chat-link/status/${roomId}`).set(header, wrongCapability).expect(401);
    await request(app).get(`/api/chat/get-users-in-channel?channel=${roomId}`).expect(400);
    await request(app).get(`/api/chat/get-users-in-channel?channel=${roomId}`).set(header, wrongCapability).expect(401);
    await request(app).delete(`/api/chat-link/${roomId}`).set(header, wrongCapability).expect(401);

    await request(app).get(`/api/chat-link/status/${roomId}`).set(header, capability).expect(200);
    await request(app).get(`/api/chat/get-users-in-channel?channel=${roomId}`).set(header, capability).expect(200, []);
    await request(app).delete(`/api/chat-link/${roomId}`).set(header, capability).expect(200);
    await request(app).get(`/api/chat-link/status/${roomId}`).set(header, capability).expect(410);
  });
});
