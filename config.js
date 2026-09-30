// Monolith runtime config. Everything is client-side.
//
// Keys are never committed (GitHub reports public keys to Google, which disables them).
// Where the Gemini key comes from, first match wins:
//   1. ?key=... in the page URL (remembered in this browser, then removed from the address bar)
//   2. the browser's saved key: click the Gemini status pill in the top bar to enter it
//   3. config.local.js (gitignored) -> export default { GEMINI_KEY: '...' }
//      On GitHub Pages, the deploy workflow (.github/workflows/pages.yml) writes this file from the
//      GEMINI_KEY repository secret, so the hosted site works for visitors without setup.

// GitHub Pages has no local render cache (it's gitignored); skip that request there.
export const IS_HOSTED = typeof location !== 'undefined' && /\.github\.io$/.test(location.hostname);

let local = {};
try {
  local = (await import('./config.local.js')).default || {};
} catch { /* not present: no key unless provided via URL or the Gemini pill */ }

const KEY_STORAGE = 'monolith.geminiKey';

function browserKey() {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('key');
    if (fromUrl) {
      localStorage.setItem(KEY_STORAGE, fromUrl);
      url.searchParams.delete('key');
      history.replaceState(null, '', url);
      return fromUrl;
    }
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setGeminiKey(key) {
  CONFIG.GEMINI_KEY = key.trim();
  try { localStorage.setItem(KEY_STORAGE, CONFIG.GEMINI_KEY); } catch { /* storage blocked */ }
}

export const CONFIG = {
  // Gemini API key (AI Studio / generativelanguage.googleapis.com).
  GEMINI_KEY: browserKey() || local.GEMINI_KEY || '',

  // Google Maps JS key ("AIza..."), with Maps JavaScript API + Map Tiles API enabled.
  // Leave empty to hide the Photoreal 3D view. The Gemini key does NOT work for Maps.
  GOOGLE_MAPS_KEY: local.GOOGLE_MAPS_KEY || '',

  // Comms email pipeline: a generic investor recipient (example.com is a reserved placeholder domain).
  COMMS: {
    recipient: { name: 'Investment Team', greeting: 'Investment Team', org: 'your fund', email: 'investors@example.com', ...(local.COMMS?.recipient || {}) },
    sender: local.COMMS?.sender || 'The Monolith team',
  },

  MODELS: {
    text: 'gemini-3.8-flash',          // orchestrator, agents (generateContent)
    textFallbacks: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'], // tried in order if busy / out of quota
    image: 'gemini-3.1-flash-image',   // concept renders (Nano Banana)
    omni: 'gemini-omni-1.1-flash',     // flythrough video (Interactions API)
    video: 'veo-3.1-fast-generate-preview', // alternative video path (long-running op)
    live: 'gemini-3.8-live',           // voice copilot (Live API, native audio)
  },

  // When a Gemini call fails or times out, agents show canned demo output instead of an error.
  DEMO_FALLBACK: true,

  // Agent result cache: data/cache/ (project files, see `npm run prewarm`) -> browser IndexedDB -> live.
  CACHE: {
    enabled: true,
    matchSite: false,                 // true = reuse a cached result for the same site even if design params changed
    simulatedDelayMs: [1400, 3200],   // cached results appear after a short "working" beat instead of instantly
    // Background pre-rendering: when a site is picked or the design settles, Render Studio starts the image
    // and flythrough immediately, so clicking Render later picks up the job already in progress.
    prefetch: { enabled: true, video: true, settleMs: 4000 },
    prewarm: {                        // what `npm run prewarm` generates
      sites: ['site-1', 'site-6', 'site-7'],
      styles: ['dusk'],
      comms: ['brief', 'community', 'investor'],
      video: true,
    },
  },

  MAP: {
    style: 'https://tiles.openfreemap.org/styles/positron',
    startMode: '2d',                              // '2d' | '3d' — how the app opens (and returns to on Reset / Home)
    bounds: [[103.605, 1.205], [104.045, 1.475]], // whole of Singapore, fitted to the window
    center: [103.83, 1.345],
    zoom: 11.2,
    pitch: 0,
    bearing: 0,
  },
};
