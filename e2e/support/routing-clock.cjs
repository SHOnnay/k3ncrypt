// Test process only: no network clock controls and no production environment.
const fs = require('node:fs');
const file = process.env.K3NCRYPT_ROUTING_TEST_CLOCK;
if (process.env.NODE_ENV !== 'test' || !file?.startsWith('/private/tmp/k3ncrypt-routing-clock-')) throw new Error('Isolated routing clock required');
if (new URL(process.env.MONGO_URI).hostname !== '127.0.0.1' || !process.env.MONGO_DB_NAME?.startsWith('k3ncrypt_playwright_routing_')) throw new Error('Disposable loopback database required');
const RealDate = Date;
function offset() { const n = Number(fs.readFileSync(file, 'utf8')); if (!Number.isFinite(n) || n < 0 || n > 31 * 86400000) throw new Error('Invalid test clock'); return n; }
global.Date = class extends RealDate {
  constructor(...args) { if (!args.length) super(RealDate.now() + offset()); else super(...args); }
  static now() { return RealDate.now() + offset(); }
};
