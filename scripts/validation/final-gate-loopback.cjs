// Disposable production-mode acceptance only. No remote service or owner data.
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, chmodSync, existsSync, readFileSync, rmSync } = require('node:fs');
const { randomBytes, createHash } = require('node:crypto');
const https = require('node:https'), http = require('node:http'), net = require('node:net');
const { MongoClient } = require('mongodb');
const uri = process.env.K3NCRYPT_RELEASE_GATE_MONGO_URI;
if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Explicit disposable loopback Mongo required');
if (existsSync('.env')) throw new Error('Refuse a checkout with local environment credentials');
if (!existsSync('dist/index.js') || !existsSync('client/dist/index.html')) throw new Error('Compile this checkout first');
const directory = mkdtempSync('/private/tmp/k3ncrypt-final-gate-tls-'); chmodSync(directory, 0o700);
const databaseName = 'k3ncrypt_playwright_final_prod_' + randomBytes(12).toString('hex');
const origin = 'https://final-gate.localhost:43473';
const env = { PATH: process.env.PATH, NODE_ENV: 'production', MONGO_URI: uri, MONGO_DB_NAME: databaseName,
  PORT: '43471', K3NCRYPT_BIND_HOST: '127.0.0.1', K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: randomBytes(32).toString('hex'),
  K3NCRYPT_ALLOWED_ORIGINS: origin, CHAT_LINK_DOMAIN: origin, K3NCRYPT_TRUST_PROXY: 'true', K3NCRYPT_INSTANCE_COUNT: '1',
  K3NCRYPT_DURABLE_ROUTING: 'true', CHATE2EE_ENABLE_DEBUG_LOGS: 'false' };
let child, proxy, cleaning = false;
async function cleanup(code = 0) {
  if (cleaning) return; cleaning = true;
  if (proxy) proxy.closeAllConnections?.(); proxy?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
  }
  const mongo = await new MongoClient(uri).connect(); try { await mongo.db(databaseName).dropDatabase(); } finally { await mongo.close(); }
  rmSync(directory, { recursive: true, force: true }); process.exit(code);
}
process.on('SIGTERM', () => void cleanup()); process.on('SIGINT', () => void cleanup());
async function main() {
  for (const port of [43471, 43473]) {
    await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
  }
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', directory + '/key.pem', '-out', directory + '/cert.pem', '-days', '1', '-subj', '/CN=final-gate.localhost', '-addext', 'subjectAltName=DNS:final-gate.localhost'], { stdio: 'ignore' });
  chmodSync(directory + '/key.pem', 0o600); chmodSync(directory + '/cert.pem', 0o600);
  // Only the new synthetic database is migrated; no production environment is inherited.
  execFileSync(process.execPath, ['dist/scripts/migrate.js'], { env, stdio: 'ignore' });
  child = spawn(process.execPath, ['--max-old-space-size=320', 'dist/index.js'], { env, stdio: 'ignore' });
  child.once('exit', () => { if (!cleaning) void cleanup(1); });
  const valid = req => req.headers.host === 'final-gate.localhost:43473' || req.headers.host === '127.0.0.1:43473' && ['/api/health', '/api/ready'].includes(req.url);
  proxy = https.createServer({ key: readFileSync(directory + '/key.pem'), cert: readFileSync(directory + '/cert.pem') }, (req, res) => {
    if (!valid(req)) { res.writeHead(404); res.end(); return; }
    const upstream = http.request({ host: '127.0.0.1', port: 43471, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.on('upgrade', (req, socket, head) => {
    if (!valid(req)) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const upstream = net.connect(43471, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (const [key, value] of Object.entries(req.headers)) if (!['x-forwarded-proto', 'x-forwarded-for'].includes(key)) upstream.write(`${key}: ${value}\r\n`);
      upstream.write('X-Forwarded-Proto: https\r\nX-Forwarded-For: 127.0.0.1\r\n\r\n'); upstream.write(head); socket.pipe(upstream).pipe(socket);
    }); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  });
  proxy.listen(43473, '127.0.0.1');
  console.log(JSON.stringify({ fixture: 'final-production-gate', source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), backendEntrySha256: createHash('sha256').update(readFileSync('dist/index.js')).digest('hex'), clientIndexSha256: createHash('sha256').update(readFileSync('client/dist/index.html')).digest('hex'), heapMiB: 320, loopbackOnly: true }));
  setTimeout(() => void cleanup(1), 10 * 60 * 1000).unref();
}
main().catch(() => { console.error('Disposable production fixture setup failed; no production resources accessed'); void cleanup(1); });
