// Disposable LOOPBACK ONLY stage. No runtime imports or production changes.
const { execFileSync: run } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const dir = '/private/tmp/phase4b-b-stage';
const image = 'sha256:eab54fa08898aa6768d01a377db899dfda77ed763ddaeef681963559e2ce4f77';
const names = ['phase4b-b-proxy', 'phase4b-b-app', 'phase4b-b-mongo'];
const networks = ['phase4b-b-internal', 'phase4b-b-ingress'];
const labelKey = 'k3ncrypt.phase4b.owner';
const docker = (...args) => run('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const write = (name, text) => fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 });
if (process.argv[2] === 'stop') {
  if (!fs.existsSync(path.join(dir, 'owner'))) throw new Error('No stage ownership receipt; refuse automatic cleanup.');
  const owner = fs.readFileSync(path.join(dir, 'owner'), 'utf8').trim();
  if (!/^[a-f0-9]{32}$/.test(owner)) throw new Error('Invalid stage ownership receipt.');
  const owned = [];
  for (const [kind, values] of [['container', [...names, 'phase4b-b-migrate']], ['network', networks]]) {
    for (const name of values) {
      let result;
      try { result = JSON.parse(docker(kind, 'inspect', name))[0]; }
      catch { continue; }
      const labels = kind === 'container' ? result.Config.Labels : result.Labels;
      if (labels?.[labelKey] !== owner) throw new Error('Resource ownership mismatch; nothing removed.');
      owned.push([kind, name]);
    }
  }
  for (const [kind, name] of owned) docker(kind, 'rm', ...(kind === 'container' ? ['-f', name] : [name]));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Owned stage resources and temporary secrets removed.');
} else if (['start', 'start-reviewed-client'].includes(process.argv[2])) {
  const reviewedClient = process.argv[2] === 'start-reviewed-client';
  const clientDist = path.join(root, 'client/dist');
  if (reviewedClient && !fs.existsSync(path.join(clientDist, 'index.html'))) throw new Error('Build the reviewed client before starting.');
  if (fs.existsSync(dir)) throw new Error('Stage directory already exists; inspect or stop this stage first.');
  for (const [kind, values] of [['container', [...names, 'phase4b-b-migrate']], ['network', networks]]) {
    const existing = docker(kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '--format', kind === 'container' ? '{{.Names}}' : '{{.Name}}').trim().split('\n');
    if (values.some(name => existing.includes(name))) throw new Error('Stage resource name already exists; refuse reuse.');
  }
  docker('image', 'inspect', image);
  fs.mkdirSync(dir, { mode: 0o700 });
  const owner = randomBytes(16).toString('hex');
  write('owner', owner);
  const label = `${labelKey}=${owner}`;
  const password = randomBytes(32).toString('hex');
  write('mongo.env', `MONGO_INITDB_ROOT_USERNAME=stage\nMONGO_INITDB_ROOT_PASSWORD=${password}\n`);
  const common = `MONGO_URI=mongodb://stage:${password}@phase4b-b-mongo:27017/?authSource=admin\nMONGO_DB_NAME=phase4b_b\nK3NCRYPT_DEVICE_TRUST_PROOF_SECRET=${randomBytes(32).toString('hex')}\nNODE_ENV=production\nK3NCRYPT_ALLOWED_ORIGINS=https://phase4b.localhost:3453\nCHAT_LINK_DOMAIN=https://phase4b.localhost:3453\nK3NCRYPT_TRUST_PROXY=true\nK3NCRYPT_INSTANCE_COUNT=1\nNODE_OPTIONS=--max-old-space-size=320\n`;
  write('app.env', common);
  write('test.env', `K3NCRYPT_ATTACHMENT_TRUST_MONGO_URI=mongodb://stage:${password}@127.0.0.1:27017/?authSource=admin\n`);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=phase4b.localhost', '-addext', 'subjectAltName=DNS:phase4b.localhost'], { stdio: 'ignore' });
  fs.chmodSync(path.join(dir, 'key.pem'), 0o600);
  docker('image', 'inspect', image);
  docker('network', 'create', '--label', label, '--internal', 'phase4b-b-internal');
  docker('network', 'create', '--label', label, 'phase4b-b-ingress');
  docker('run', '-d', '--label', label, '--name', names[2], '--network', 'phase4b-b-internal', '--memory', '1536m', '--env-file', path.join(dir, 'mongo.env'), 'mongo:7', '--bind_ip_all', '--auth');
  let ready = false;
  for (let n = 0; n < 60; n++) { try { docker('exec', names[2], 'mongosh', '--quiet', '--eval', 'quit(db.runCommand({ping:1}).ok ? 0 : 1)'); ready = true; break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } }
  if (!ready) throw new Error('Disposable Mongo did not start.');
  docker('run', '--rm', '--label', label, '--name', 'phase4b-b-migrate', '--network', 'phase4b-b-internal', '--env-file', path.join(dir, 'app.env'), image, 'node', 'dist/scripts/migrate.js');
  docker('run', '-d', '--label', label, '--name', names[1], '--network', 'phase4b-b-internal', '--memory', '512m', '--cpus', '1', '--env-file', path.join(dir, 'app.env'), ...(reviewedClient ? ['-v', `${clientDist}:/app/client/dist:ro`] : []), image);
  docker('run', '-d', '--label', label, '--name', names[0], '--network', 'phase4b-b-ingress', '--memory', '128m', '-p', '127.0.0.1:3453:3453', '-v', `${dir}:/stage:ro`, '-v', `${path.join(root, 'scripts/staging')}:/tooling:ro`, 'node:22-alpine', 'node', '/tooling/phase4b/proxy.cjs');
  docker('network', 'connect', 'phase4b-b-internal', names[0]);
  console.log('On setup failure, use stop with the retained ownership receipt; never remove unrelated resources.');
  console.log('Loopback stage started at https://phase4b.localhost:3453; browser exception only.');
} else throw new Error('Usage: node scripts/staging/phase4b/loopback.cjs start|start-reviewed-client|stop');
