import 'dotenv/config';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = path.join(repositoryRoot, 'android/app/build/local-video-interop');
const origin = new URL(readFileSync(path.join(stateDirectory, 'origin'), 'utf8').trim());
if (origin.protocol !== 'https:' || !origin.hostname || !origin.port) throw new Error('Local HTTPS endpoint configuration is invalid.');

const backendPort = Number(process.env.PORT ?? '3001');
const commonHeaders = (request) => {
  const headers = { ...request.headers, host: `127.0.0.1:${backendPort}` };
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  delete headers.forwarded;
  return headers;
};

const server = https.createServer({
  key: readFileSync(path.join(stateDirectory, 'server.key')),
  cert: readFileSync(path.join(stateDirectory, 'server.crt')),
}, (request, response) => {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: backendPort,
    method: request.method,
    path: request.url || '/',
    headers: commonHeaders(request),
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});

server.on('upgrade', (request, clientSocket, clientHead) => {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: backendPort,
    method: request.method,
    path: request.url || '/',
    headers: commonHeaders(request),
  });
  upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    clientSocket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? 'Proxy'}\r\n`);
    for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
      clientSocket.write(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}\r\n`);
    }
    clientSocket.write('\r\n');
    if (clientHead.length) upstreamSocket.write(clientHead);
    if (upstreamHead.length) clientSocket.write(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstream.on('response', (upstreamResponse) => {
    clientSocket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? 'Proxy'}\r\n`);
    for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
      clientSocket.write(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}\r\n`);
    }
    clientSocket.write('\r\n');
    upstreamResponse.pipe(clientSocket);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
  upstream.end();
});

server.on('error', (error) => {
  process.stderr.write(error.code === 'EADDRINUSE'
    ? 'The local HTTPS test port is already in use.\n'
    : 'The local HTTPS test endpoint could not start.\n');
  process.exitCode = 1;
});

server.listen(Number(origin.port), origin.hostname, () => {
  process.stdout.write('Local HTTPS proxy is listening on the detected LAN interface; request and media data logging is disabled.\n');
});
