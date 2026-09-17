const enabled = process.env.CHATE2EE_ENABLE_DEBUG_LOGS === 'true';

/** Debug output is opt-in so production builds do not leak runtime context. */
export const debugError = (message: string, error?: unknown): void => {
  if (enabled) console.error(`[K3ncrypt] ${message}`, error);
};

export const debugWarn = (message: string, error?: unknown): void => {
  if (enabled) console.warn(`[K3ncrypt] ${message}`, error);
};
