const configuredOrigins = (): string[] => (process.env.K3NCRYPT_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const allowedCorsOrigins = (): string[] => {
  const configured = configuredOrigins();
  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : [];
};

/** No configured production origins means same-origin only (no CORS response headers). */
export const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void => {
  if (!origin) {
    callback(null, true);
    return;
  }
  callback(null, allowedCorsOrigins().includes(origin));
};
