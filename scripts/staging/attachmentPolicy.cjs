'use strict';
/** STAGING PROXY ONLY. Never mounted by the production application.
 * Fail closed for ambiguous paths; queries are not inspected or logged.
 * Apply before forwarding HTTP requests/upgrades to an internal-only backend.
 */
const allowStagingPath = (target) => {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return false;
  const rawPath = target.split('?')[0];
  if (/[\\%#\x00-\x20\x7f]/.test(rawPath)) return false;
  let path;
  try { path = new URL(target, 'https://stage.invalid').pathname; } catch { return false; }
  if (/^\/api\/attachments(?:\/|$)/i.test(path)) return /^\/api\/attachments\/v2\/(?:create|[0-9a-f-]{36}(?:\/(?:manifest|complete|chunks\/[0-9]{1,2}))?)$/.test(path);
  return true;
};
module.exports = { allowStagingPath };
