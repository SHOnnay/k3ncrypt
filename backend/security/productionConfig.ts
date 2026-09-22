export const validateProductionConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.MONGO_URI || !env.MONGO_DB_NAME) {
    throw new Error('Production requires shared persistent storage for modern delivery.');
  }
  if (!env.K3NCRYPT_ALLOWED_ORIGINS) throw new Error('Production requires explicit allowed origins.');
  for (const value of env.K3NCRYPT_ALLOWED_ORIGINS.split(',')) {
    try { const origin = new URL(value.trim()); if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid'); }
    catch { throw new Error('Production allowed origin is invalid.'); }
  }
  if (env.K3NCRYPT_TRUST_PROXY !== 'true') throw new Error('Production requires explicit trusted proxy configuration.');
  const instances = Number(env.K3NCRYPT_INSTANCE_COUNT || '1');
  if (!Number.isInteger(instances) || instances < 1) throw new Error('Production instance count is invalid.');
  if (instances > 1) throw new Error('Multiple production instances are unsupported until a reviewed Socket.IO adapter is configured.');
  if (env.CHATE2EE_ENABLE_DEBUG_LOGS === 'true') throw new Error('Debug logging must be disabled in production.');
  if (!env.CHAT_LINK_DOMAIN) throw new Error('Production requires an explicit chat link domain.');
  if (!env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET || env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET.length < 32) throw new Error('Production requires a device trust proof secret.');
  try {
    const origin = new URL(env.CHAT_LINK_DOMAIN);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid');
  } catch {
    throw new Error('Production chat link domain is invalid.');
  }
};
