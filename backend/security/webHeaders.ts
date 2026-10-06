import type { NextFunction, Request, Response } from 'express';

/** Only explicit HTTPS origins become CSP sources; never interpolate arbitrary header text. */
export const webSecurityHeaders = (apiOrigin = process.env.CHATE2EE_API_URL || process.env.CHAT_LINK_DOMAIN || ''): Record<string, string> => {
  const connections = ["'self'"];
  if (apiOrigin.trim()) {
    const url = new URL(apiOrigin.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Web CSP requires an HTTPS API origin.');
    connections.push(url.origin, `wss://${url.host}`);
  }
  return {
    'Content-Security-Policy': ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'", "style-src-elem 'self'", "style-src-attr 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:", `connect-src ${connections.join(' ')}`, "worker-src 'self'"].join('; '),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  };
};

export const productionWebHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV === 'production') res.set(webSecurityHeaders());
  next();
};
