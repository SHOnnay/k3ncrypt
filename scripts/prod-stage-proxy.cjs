// Loopback HTTPS front for the local production stage (scripts/prod-stage.sh). It appends the
// client address to X-Forwarded-For exactly like a single trusted proxy (Render) does.
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const appPort = Number(process.env.APP_PORT);
const server = https.createServer({ key: fs.readFileSync(process.env.STAGE_KEY), cert: fs.readFileSync(process.env.STAGE_CERT) }, (req, res) => {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress };
  const upstream = http.request({ host: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers }, (response) => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(appPort, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [key, value] of Object.entries(req.headers)) if (key !== 'x-forwarded-for') upstream.write(`${key}: ${value}\r\n`);
    upstream.write(`X-Forwarded-For: ${socket.remoteAddress}\r\nX-Forwarded-Proto: https\r\n\r\n`); upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
server.listen(Number(process.env.HTTPS_PORT), '127.0.0.1');
