import { validateProductionConfig } from './productionConfig';

describe('production safety validation', () => {
  const base = { NODE_ENV: 'production', MONGO_URI: 'mongodb://shared', MONGO_DB_NAME: 'k3ncrypt', CHAT_LINK_DOMAIN: 'https://chat.example.test', K3NCRYPT_ALLOWED_ORIGINS: 'https://chat.example.test', K3NCRYPT_TRUST_PROXY: 'true' };

  it('rejects volatile or unreviewed multi-instance production', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'production' })).toThrow('shared persistent storage');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_INSTANCE_COUNT: '2' })).toThrow('Socket.IO adapter');
  });

  it('rejects debug logging in production and permits explicit single-instance mode', () => {
    expect(() => validateProductionConfig({ ...base, CHATE2EE_ENABLE_DEBUG_LOGS: 'true' })).toThrow('Debug logging');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_INSTANCE_COUNT: '1' })).not.toThrow();
    expect(() => validateProductionConfig({ ...base, CHAT_LINK_DOMAIN: 'not-a-domain' })).toThrow('domain is invalid');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_ALLOWED_ORIGINS: 'http://chat.example.test' })).toThrow('allowed origin is invalid');
    expect(() => validateProductionConfig({ ...base, K3NCRYPT_TRUST_PROXY: 'false' })).toThrow('trusted proxy');
  });
});
