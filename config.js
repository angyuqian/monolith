// Monolith runtime config. Everything is client-side.
//
// Keys are NOT committed (GitHub push protection blocks them, and Google disables leaked keys).
// Where the Gemini key comes from, first match wins:
//   1. config.local.js (gitignored)  ->  export default { GEMINI_KEY: '...', GOOGLE_MAPS_KEY: '' }
//   2. ?key=... in the page URL (remembered in this browser, then removed from the address bar)
//   3. the browser's saved key: click the Gemini status pill in the top bar to enter it
let local = {};
try {
  local = (await import('./config.local.js')).default || {};
} catch { /* not present, e.g. on GitHub Pages */ }

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
  GEMINI_KEY: local.GEMINI_KEY || browserKey(),

  // Google Maps JS key ("AIza..."), with Maps JavaScript API + Map Tiles API enabled.
  // Leave empty to hide the Photoreal 3D view. The Gemini key does NOT work for Maps.
  GOOGLE_MAPS_KEY: local.GOOGLE_MAPS_KEY || '',

  MODELS: {
    text: 'gemini-3.8-flash',          // orchestrator, agents (generateContent)
    image: 'gemini-3.1-flash-image',   // concept renders (Nano Banana)
    omni: 'gemini-omni-1.1-flash',     // flythrough video (Interactions API)
    video: 'veo-3.1-fast-generate-preview', // alternative video path (long-running op)
  },

  // When a Gemini call fails or times out, agents show canned demo output instead of an error.
  DEMO_FALLBACK: true,

  // Agent result cache: data/cache/ (project files, see `npm run prewarm`) -> browser IndexedDB -> live.
  CACHE: {
    enabled: true,
    matchSite: false,                 // true = reuse a cached result for the same site even if design params changed
    simulatedDelayMs: [1400, 3200],   // cached results appear after a short "working" beat instead of instantly
    prewarm: {                        // what `npm run prewarm` generates
      sites: ['site-1', 'site-6', 'site-7'],
      styles: ['dusk'],
      comms: ['brief', 'community'],
      video: true,
    },
  },

  MAP: {
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [103.83, 1.345],
    zoom: 11.2,
    pitch: 50,
    bearing: -18,
  },
};
