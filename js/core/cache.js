// Result cache for agent runs: project files (data/cache/) -> browser IndexedDB -> live generation.
//
//   exact key: agent | variant | site | design-params hash   (e.g. "render|video:dusk|site-1|3f9a2c")
//   site key:  agent | variant | site                        (fallback when CONFIG.CACHE.matchSite is on)
//
// Project files are produced by `npm run prewarm` (scripts/prewarm.mjs) and shared with the team.
// Everything generated live is also saved to IndexedDB, so it's instant next time on this machine.
import { CONFIG } from '../../config.js';

const DB = 'monolith-cache';
const STORE = 'results';
const opts = { read: CONFIG.CACHE?.enabled !== false };
let manifest = { version: 1, entries: {} };
const projectBySite = new Map(); // siteKey -> exact key
const session = [];              // entries written this page session (exported by the prewarm script)
const pending = new Set();       // in-flight puts
const inflight = new Map();      // exact key -> Promise<result> (background pre-generation)
let dbp = null;

function hash(obj) {
  const s = JSON.stringify(obj, Object.keys(obj || {}).sort());
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function cacheKeys({ agentId, variant = 'run', scope = 'site', site, params }) {
  if (scope === 'global') {
    const k = `${agentId}|${variant}|global`;
    return { key: k, siteKey: k };
  }
  if (!site) return null;
  const siteKey = `${agentId}|${variant}|${site.id}`;
  return { key: `${siteKey}|${hash(params || {})}`, siteKey };
}

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'key' });
        s.createIndex('siteKey', 'siteKey');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode / blocked storage: cache quietly disabled
    }
  });
  return dbp;
}

async function idb(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function fromProject(key) {
  const e = manifest.entries[key];
  if (!e) return null;
  const result = structuredClone(e.result);
  if (e.media) result.media = { type: e.media.type, src: `data/cache/media/${e.media.file}` };
  return result;
}

function fromRecord(rec) {
  if (!rec) return null;
  const result = structuredClone(rec.result);
  if (rec.blob) result.media = { type: rec.mediaType, src: URL.createObjectURL(rec.blob) };
  return result;
}

export const cache = {
  async init() {
    try {
      const res = await fetch('data/cache/manifest.json', { cache: 'no-store' });
      if (res.ok) manifest = await res.json();
    } catch { /* no project cache yet */ }
    Object.entries(manifest.entries || {}).forEach(([k, e]) => projectBySite.set(e.siteKey, k));
    return Object.keys(manifest.entries || {}).length;
  },

  async get(keys) {
    if (!opts.read || !keys) return null;
    const exact = fromProject(keys.key) || fromRecord(await idb('readonly', (s) => s.get(keys.key)));
    if (exact) return exact;
    if (inflight.has(keys.key)) { // being generated in the background: wait for it instead of starting again
      const r = await inflight.get(keys.key).catch(() => null);
      if (r) return { ...structuredClone({ ...r, media: undefined }), media: r.media, prefetched: true };
    }
    if (!CONFIG.CACHE?.matchSite) return null;
    const pk = projectBySite.get(keys.siteKey);
    if (pk) return fromProject(pk);
    const recs = await idb('readonly', (s) => s.index('siteKey').getAll(keys.siteKey));
    return fromRecord(recs?.sort((a, b) => b.t - a.t)[0]);
  },

  put(keys, result) {
    if (!keys || !result || result.offline || result.cached || result.status === 'error') return null;
    const p = cache._put(keys, result).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  },

  async _put(keys, result) {
    const clean = structuredClone({ ...result, media: undefined });
    if (clean.data?.snapshot) delete clean.data.snapshot; // big and only needed live
    let blob = null;
    if (result.media?.src) {
      try { blob = await (await fetch(result.media.src)).blob(); } catch { /* skip media */ }
    }
    const rec = { key: keys.key, siteKey: keys.siteKey, result: clean, blob, mediaType: result.media?.type, t: Date.now() };
    session.push(rec);
    await idb('readwrite', (s) => s.put(rec));
  },

  // Cached result only (project or browser) — never waits for an in-flight job.
  async peek(keys) {
    if (!opts.read || !keys) return null;
    return fromProject(keys.key) || fromRecord(await idb('readonly', (s) => s.get(keys.key)));
  },

  // Register a background generation; its result is saved like any other and served to whoever asks.
  track(keys, promise) {
    if (!keys) return promise;
    inflight.set(keys.key, promise);
    promise.then((r) => cache.put(keys, r)).catch(() => {}).finally(() => inflight.delete(keys.key));
    return promise;
  },
  isInflight: (keys) => !!keys && inflight.has(keys.key),
  readsEnabled: () => opts.read,

  async clearBrowser() {
    await idb('readwrite', (s) => s.clear());
  },

  // Used by scripts/prewarm.mjs: everything generated this session, media as base64.
  async exportSession() {
    await Promise.all([...pending]);
    const out = [];
    for (const r of session) {
      let media = null;
      if (r.blob) {
        const b64 = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1]);
          fr.readAsDataURL(r.blob);
        });
        media = { type: r.mediaType, mime: r.blob.type, base64: b64 };
      }
      out.push({ key: r.key, siteKey: r.siteKey, result: r.result, media });
    }
    return out;
  },

  setReads(on) { opts.read = on; },
  stats: () => ({ project: Object.keys(manifest.entries || {}).length, session: session.length, reads: opts.read, matchSite: !!CONFIG.CACHE?.matchSite }),
};
