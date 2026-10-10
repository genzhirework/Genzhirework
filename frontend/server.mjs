// Production server for one Angular app (Railway: one service per app).
// Serves dist/<APP>/browser with SPA fallback and proxies /api to the API service,
// so the SameSite=Strict refresh cookie stays same-origin.
//   APP      web | employer | recruiter | admin
//   API_URL  e.g. http://api.railway.internal:3000 (Railway private network)
//   PORT     set by Railway
//   WEB_URL, EMPLOYER_URL, RECRUITER_URL, ADMIN_URL  public URLs of the four apps, used for
//            cross-app links (optional; without them links assume <app>.<domain> subdomains)
import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = process.env.APP;
if (!['web', 'employer', 'recruiter', 'admin'].includes(APP)) throw new Error(`APP must be web|employer|recruiter|admin, got "${APP}"`);
let API;
try { API = new URL(process.env.API_URL ?? 'http://localhost:3000'); } catch {
  throw new Error(`API_URL "${process.env.API_URL}" is not a valid URL. On Railway, the API service must be named "api" so that \${{api.RAILWAY_PRIVATE_DOMAIN}} resolves.`);
}
const PORT = Number(process.env.PORT ?? 8080);
const ROOT = fileURLToPath(new URL(`./dist/${APP}/browser`, import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};
const client = API.protocol === 'https:' ? https : http;

const APP_URLS = Object.fromEntries(
  [['jobseeker', 'WEB_URL'], ['employer', 'EMPLOYER_URL'], ['recruiter', 'RECRUITER_URL'], ['admin', 'ADMIN_URL']]
    .filter(([, v]) => process.env[v])
    .map(([k, v]) => [k, process.env[v]]),
);
const INDEX_FILE = join(ROOT, 'index.html');
const indexHtml = readFile(INDEX_FILE, 'utf8').then((html) => Object.keys(APP_URLS).length
  ? html.replace('</head>', `<script>window.__GENZHIRE_APP_URLS__=${JSON.stringify(APP_URLS).replace(/</g, '\\u003c')}</script></head>`)
  : html);

function proxy(req, res) {
  const headers = { ...req.headers, host: API.host };
  const p = client.request({ protocol: API.protocol, hostname: API.hostname, port: API.port, path: req.url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/problem+json' });
    res.end(JSON.stringify({ title: 'API unavailable', status: 502 }));
  });
  req.pipe(p);
}

async function serveStatic(req, res) {
  let rel;
  try { rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''); } catch { rel = ''; }
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT + sep)) file = INDEX_FILE;
  try { if (!(await stat(file)).isFile()) throw 0; } catch { file = INDEX_FILE; }
  const isIndex = file === INDEX_FILE;
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // Hashed bundles are immutable; index.html must always be revalidated to pick up new deploys.
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(APP === 'web' ? {} : { 'X-Frame-Options': 'DENY' }),
  });
  res.end(req.method === 'HEAD' ? undefined : isIndex ? await indexHtml : await readFile(file));
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res).catch(() => { res.writeHead(500); res.end(); });
}).listen(PORT, () => console.log(`${APP} on :${PORT}, /api → ${API.origin}`));
