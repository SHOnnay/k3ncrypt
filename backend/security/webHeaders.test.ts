import request from 'supertest';
import app from '../../app';
import { webSecurityHeaders } from './webHeaders';
import { readFileSync } from 'fs';

describe('production Web policy', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });
  it('protects production responses and permits required disk/media/WASM operations without inline scripts', async () => {
    process.env.NODE_ENV = 'production'; process.env.CHATE2EE_API_URL = 'https://api.example.test';
    const response = await request(app).get('/api/health').expect(200);
    for (const [name, value] of Object.entries(webSecurityHeaders())) expect(response.get(name)).toBe(value);
    const csp = response.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain('https://api.example.test wss://api.example.test');
    expect(csp).toContain("media-src 'self' blob:");
  });
  it('keeps development policy separate and rejects injection/unsafe API sources', async () => {
    process.env.NODE_ENV = 'development';
    expect((await request(app).get('/api/health')).get('Content-Security-Policy')).toBeUndefined();
    for (const origin of ['http://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test/path', "https://api.example.test/?x=unsafe-inline"]) expect(() => webSecurityHeaders(origin)).toThrow();
  });
  it('uses the same policy generator for nginx and externalizes startup styles', () => {
    const template = readFileSync('docker/nginx.conf', 'utf8');
    expect(template.match(/add_header Content-Security-Policy/g)).toHaveLength(1);
    expect(readFileSync('scripts/render-nginx.cjs', 'utf8')).toContain('webSecurityHeaders');
    const html = readFileSync('client/index.html', 'utf8');
    expect(html).not.toContain('<style>'); expect(html).toContain('/startup.css');
  });
});
