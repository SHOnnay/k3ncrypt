export const validateProductionConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.MONGO_URI || !env.MONGO_DB_NAME) {
    throw new Error('Production requires shared persistent storage for modern delivery.');
  }
  const instances = Number(env.K3NCRYPT_INSTANCE_COUNT || '1');
  if (!Number.isInteger(instances) || instances < 1) throw new Error('Production instance count is invalid.');
  if (instances > 1) throw new Error('Multiple production instances are unsupported until a reviewed Socket.IO adapter is configured.');
  if (env.CHATE2EE_ENABLE_DEBUG_LOGS === 'true') throw new Error('Debug logging must be disabled in production.');
  if (!env.CHAT_LINK_DOMAIN) throw new Error('Production requires an explicit chat link domain.');
};
