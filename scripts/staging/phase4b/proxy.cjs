const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const { allowStagingPath } = require('../attachmentPolicy.cjs');
const valid = req => req.headers.host === 'phase4b.localhost:3453' && allowStagingPath(req.url);
const server = https.createServer({ key: fs.readFileSync('/stage/key.pem'), cert: fs.readFileSync('/stage/cert.pem') }, (req, res) => {
  if (!valid(req)) { res.writeHead(404); res.end(); return; }
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress };
  const upstream = http.request({ host: 'phase4b-b-app', port: 3001, method: req.method, path: req.url, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  if (!valid(req)) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  const upstream = net.connect(3001, 'phase4b-b-app', () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [key, value] of Object.entries(req.headers)) upstream.write(`${key}: ${value}\r\n`);
    upstream.write('X-Forwarded-Proto: https\r\n\r\n'); upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
server.listen(3453, '0.0.0.0'); // Docker publishes solely 127.0.0.1; no other host binding.
