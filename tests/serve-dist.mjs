// Serves the four production builds with SPA fallback and a same-origin /api proxy.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../frontend/dist', import.meta.url));
const APPS = { 4200: 'web', 4201: 'employer', 4202: 'recruiter', 4203: 'admin' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

for (const [port, app] of Object.entries(APPS)) {
  const root = join(DIST, app, 'browser');
  http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const p = http.request({ host: 'localhost', port: 3000, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', () => { res.writeHead(502); res.end('api down'); });
      req.pipe(p);
      return;
    }
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
    let file = join(root, path);
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(root, 'index.html'); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  }).listen(Number(port), () => console.log(`${app} → http://localhost:${port}`));
}
