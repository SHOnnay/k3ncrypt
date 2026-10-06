const fs = require('node:fs');
const { webSecurityHeaders } = require('../dist/backend/security/webHeaders.js');
const source = fs.readFileSync('docker/nginx.conf', 'utf8');
const csp = webSecurityHeaders()['Content-Security-Policy'];
// The policy builder only admits validated URL origins. Escape nginx string syntax too.
fs.writeFileSync(process.argv[2], source.replace('__K3NCRYPT_CSP__', csp.replace(/\\/g, '\\\\').replace(/"/g, '\\"')));
