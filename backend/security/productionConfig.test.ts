import { validateProductionConfig } from './productionConfig';
import { randomBytes } from 'crypto';

describe('production safety validation', () => {
  const base = { NODE_ENV: 'production', MONGO_URI: 'mongodb://shared', MONGO_DB_NAME: 'k3ncrypt', CHAT_LINK_DOMAIN: 'https://chat.k3ncrypt-beta.app', K3NCRYPT_ALLOWED_ORIGINS: 'https://chat.k3ncrypt-beta.app', K3NCRYPT_TRUST_PROXY: 'true', K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: randomBytes(32).toString('hex') , K3NCRYPT_DURABLE_ROUTING: 'true' };

  // P1-3 / M3b: a missing durable-routing flag must not silently fall back to client-chosen mailboxes.
  it('refuses to start without an explicit durable routing setting', () => {
    const { K3NCRYPT_DURABLE_ROUTING: _omitted, ...missing } = base;
    expect(() => validateProductionConfig(missing)).toThrow('durable routing');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_DURABLE_ROUTING: 'yes' })).toThrow('durable routing');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_DURABLE_ROUTING: 'true' })).not.toThrow();
    // Explicit false stays allowed: the maintenance cutover bridge deploys with it.
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_DURABLE_ROUTING: 'false' })).not.toThrow();
  });

  it('rejects volatile or unreviewed multi-instance production', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'production' })).toThrow('shared persistent storage');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_INSTANCE_COUNT: '2' })).toThrow('Socket.IO adapter');
  });

  it('rejects debug logging in production and permits explicit single-instance mode', () => {
    expect(() => validateProductionConfig({ ...base, CHATE2EE_ENABLE_DEBUG_LOGS: 'true' })).toThrow('Debug logging');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_INSTANCE_COUNT: '1' })).not.toThrow();
    expect(() => validateProductionConfig({ ...base, CHAT_LINK_DOMAIN: 'not-a-domain' })).toThrow('domain is invalid');
    expect(() => validateProductionConfig({ ...base, CHAT_LINK_DOMAIN: 'http://chat.k3ncrypt-beta.app' })).toThrow('domain is invalid');
    expect(() => validateProductionConfig({ ...base, CHAT_LINK_DOMAIN: 'https://chat.example.com' })).toThrow('domain is invalid');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_ALLOWED_ORIGINS: 'http://chat.k3ncrypt-beta.app' })).toThrow('allowed origin is invalid');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_ALLOWED_ORIGINS: 'https://chat.example.com' })).toThrow('allowed origin is invalid');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: '<generate-a-random-secret>' })).toThrow('generated device trust proof secret');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_TRUST_PROXY: 'false' })).toThrow('trusted proxy');
  });
});
