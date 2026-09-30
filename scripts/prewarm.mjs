#!/usr/bin/env node
// Pre-generate agent results (renders, Omni flythroughs, compliance, comms, site ranking) into data/cache/
// so the demo's rehearsed path is instant and works offline. Commit data/cache/ to share with the team.
//
//   npm install            (once — installs puppeteer-core; uses your installed Chrome)
//   npm run prewarm                                  # uses CONFIG.CACHE.prewarm from config.js
//   npm run prewarm -- --sites site-1,site-3 --styles dusk,night --no-video
//   npm run prewarm -- --sites site-7 --only video        # retry just one step (scout,compliance,comms,image,video)
//
// Env: CHROME_PATH=/path/to/chrome if Chrome isn't in the default location.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CONFIG } from '../config.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const MEDIA_DIR = path.join(CACHE_DIR, 'media');

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const plan = CONFIG.CACHE.prewarm;
const SITES = list(arg('sites'), plan.sites);
const STYLES = list(arg('styles'), plan.styles);
const COMMS = list(arg('comms'), plan.comms);
const VIDEO = argv.includes('--no-video') ? false : plan.video;
const ONLY = list(arg('only'), null);
const want = (step) => !ONLY || ONLY.includes(step);

// ---- tiny static server -----------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = p.endsWith(path.sep) ? path.join(p, 'index.html') : p;
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

// ---- browser -----------------------------------------------------------------
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found — set CHROME_PATH'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 }, // retina-quality snapshots
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  [page]', e.message));
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`.padStart(5);
const log = (...a) => console.log(secs(), ...a);

log(`app ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loader.is-done', { timeout: 120000 });
await page.evaluate(() => window.monolith.cache.setReads(false)); // always generate fresh

async function run(label, fn, arg) {
  const s = Date.now();
  const r = await page.evaluate(fn, arg);
  const ok = r && !r.offline && r.status !== 'error';
  log(`${ok ? '✓' : '✗'} ${label.padEnd(28)} ${Math.round((Date.now() - s) / 1000)}s  ${(r?.summary || '').slice(0, 70)}`);
}

if (want('scout')) await run('siteScout', () => window.monolith.actions.runAgent('siteScout').then((r) => ({ status: r.status, summary: r.summary, offline: r.offline })));

for (const siteId of SITES) {
  log(`— ${siteId}`);
  await page.evaluate(async (id) => {
    const { actions, map } = window.monolith;
    actions.selectSite(id);
    await new Promise((r) => setTimeout(r, 500));
    while (map.map.isMoving()) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => { map.map.once('idle', r); setTimeout(r, 4000); });
  }, siteId);
  const agent = (id, opts) => window.monolith.actions.runAgent(id, opts).then((r) => ({ status: r.status, summary: r.summary, offline: r.offline }));
  if (want('compliance')) await run('compliance', agent, 'compliance');
  if (want('comms')) for (const type of COMMS) await run(`comms:${type}`, ([id, t]) => window.monolith.actions.runAgent(id, { type: t }).then((r) => ({ status: r.status, summary: r.summary, offline: r.offline })), ['comms', type]);
  for (const style of STYLES) {
    if (want('image')) await run(`render image:${style}`, (s) => window.monolith.actions.runAgent('render', { style: s }).then((r) => ({ status: r.status, summary: r.summary, offline: r.offline })), style);
    if (VIDEO && want('video')) await run(`render video:${style}`, (s) => window.monolith.registry.tool('render_flythrough').handler({ style: s }, window.monolith), style);
  }
}

// ---- write data/cache ----------------------------------------------------------
const entries = await page.evaluate(() => window.monolith.cache.exportSession());
await browser.close();
server.close();

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const manifestPath = path.join(CACHE_DIR, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, entries: {} };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
let bytes = 0;
for (const e of entries) {
  const out = { siteKey: e.siteKey, result: e.result, createdAt: new Date().toISOString() };
  if (e.media) {
    const file = `${e.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${EXT[e.media.mime] || 'bin'}`;
    const buf = Buffer.from(e.media.base64, 'base64');
    fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
    bytes += buf.length;
    out.media = { type: e.media.type, file };
  }
  manifest.entries[e.key] = out;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
log(`wrote ${entries.length} entries (${(bytes / 1e6).toFixed(1)} MB media) → data/cache/  ·  ${Object.keys(manifest.entries).length} total`);
