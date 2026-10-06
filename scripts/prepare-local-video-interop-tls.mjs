import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = path.join(repositoryRoot, 'android/app/build/local-video-interop');
const generatedResources = path.join(repositoryRoot, 'android/app/build/generated/localVideoInterop/res');

const runOpenSsl = (args) => {
  try {
    execFileSync('openssl', args, { stdio: 'ignore' });
  } catch {
    throw new Error('OpenSSL could not prepare local video-interoperability certificates.');
  }
};

const isPrivateLanAddress = (address) => {
  const octets = address.split('.').map(Number);
  return octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) &&
    (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
};

const discoverLanAddress = () => {
  let route;
  try {
    route = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Could not identify the active Mac network interface. Connect to the test Wi-Fi with VPN off.');
  }
  const interfaceName = route.match(/^\s*interface:\s*(\S+)/m)?.[1];
  const addresses = interfaceName ? networkInterfaces()[interfaceName] ?? [] : [];
  const address = addresses.find((entry) => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal && isPrivateLanAddress(entry.address));
  if (!address) throw new Error('Could not identify a private IPv4 address on the active Mac network interface.');
  return address.address;
};

const lanAddress = discoverLanAddress();
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
chmodSync(stateDirectory, 0o700);

const caKey = path.join(stateDirectory, 'local-dev-ca.key');
const caCertificate = path.join(stateDirectory, 'ca.crt');
const caConfig = path.join(stateDirectory, 'ca.cnf');
if (!existsSync(caKey) || !existsSync(caCertificate)) {
  writeFileSync(caConfig, `[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\nprompt=no\n[dn]\nCN=K3NCRYPT Local Video Interop Development CA\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`);
  runOpenSsl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', caKey]);
  chmodSync(caKey, 0o600);
  runOpenSsl(['req', '-x509', '-new', '-key', caKey, '-out', caCertificate, '-days', '90', '-sha256', '-config', caConfig, '-extensions', 'v3_ca']);
}

const serverKey = path.join(stateDirectory, 'server.key');
const serverRequest = path.join(stateDirectory, 'server.csr');
const serverCertificate = path.join(stateDirectory, 'server.crt');
const serverExtensions = path.join(stateDirectory, 'server.ext');
writeFileSync(serverExtensions, `[server_cert]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${lanAddress},DNS:localhost,IP:127.0.0.1\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`);
runOpenSsl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', serverKey]);
chmodSync(serverKey, 0o600);
runOpenSsl(['req', '-new', '-key', serverKey, '-out', serverRequest, '-subj', '/CN=K3NCRYPT Local Video Interop HTTPS']);
runOpenSsl(['x509', '-req', '-in', serverRequest, '-CA', caCertificate, '-CAkey', caKey, '-CAcreateserial', '-out', serverCertificate, '-days', '14', '-sha256', '-extfile', serverExtensions, '-extensions', 'server_cert']);

const origin = `https://${lanAddress}:3443`;
writeFileSync(path.join(stateDirectory, 'origin'), `${origin}\n`, { mode: 0o600 });

const xmlDirectory = path.join(generatedResources, 'xml');
const rawDirectory = path.join(generatedResources, 'raw');
mkdirSync(xmlDirectory, { recursive: true });
mkdirSync(rawDirectory, { recursive: true });
writeFileSync(path.join(xmlDirectory, 'network_security_config_local_interop.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="false">\n        <trust-anchors><certificates src="system" /></trust-anchors>\n    </base-config>\n    <domain-config cleartextTrafficPermitted="true">\n        <domain includeSubdomains="false">10.0.2.2</domain>\n    </domain-config>\n    <domain-config cleartextTrafficPermitted="false">\n        <domain includeSubdomains="false">${lanAddress}</domain>\n        <trust-anchors>\n            <certificates src="system" />\n            <certificates src="@raw/k3ncrypt_local_dev_ca" />\n        </trust-anchors>\n    </domain-config>\n</network-security-config>\n`);
writeFileSync(path.join(rawDirectory, 'k3ncrypt_local_dev_ca.crt'), readFileSync(caCertificate));

const clientEnvPath = path.join(repositoryRoot, 'client/.env.local');
const currentClientEnv = existsSync(clientEnvPath) ? readFileSync(clientEnvPath, 'utf8') : '';
const apiOriginLine = `CHATE2EE_API_URL=${origin}`;
const nextClientEnv = /^CHATE2EE_API_URL=.*$/m.test(currentClientEnv)
  ? currentClientEnv.replace(/^CHATE2EE_API_URL=.*$/m, apiOriginLine)
  : `${currentClientEnv}${currentClientEnv && !currentClientEnv.endsWith('\n') ? '\n' : ''}${apiOriginLine}\n`;
writeFileSync(clientEnvPath, nextClientEnv, { mode: 0o600 });

const developmentClientEnvPath = path.join(repositoryRoot, 'client/.env.development.local');
const currentDevelopmentClientEnv = existsSync(developmentClientEnvPath)
  ? readFileSync(developmentClientEnvPath, 'utf8')
  : '';
const developmentApiOriginLine = 'CHATE2EE_API_URL=http://127.0.0.1:3001';
const nextDevelopmentClientEnv = /^CHATE2EE_API_URL=.*$/m.test(currentDevelopmentClientEnv)
  ? currentDevelopmentClientEnv.replace(/^CHATE2EE_API_URL=.*$/m, developmentApiOriginLine)
  : `${currentDevelopmentClientEnv}${currentDevelopmentClientEnv && !currentDevelopmentClientEnv.endsWith('\n') ? '\n' : ''}${developmentApiOriginLine}\n`;
writeFileSync(developmentClientEnvPath, nextDevelopmentClientEnv, { mode: 0o600 });

process.stdout.write('Local HTTPS materials generated for the active private LAN interface; addresses and keys were not printed.\n');
