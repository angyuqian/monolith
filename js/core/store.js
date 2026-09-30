// Observable app state. store.set({ key }) notifies subscribers of that key and of '*'.
const initial = {
  stage: 'site',              // 'site' | 'design' | 'review'
  mode: '2d',                 // '2d' | '3d' (starts as CONFIG.MAP.startMode)
  sites: [],                  // candidate sites from data/build/sites.json
  site: null,                 // selected site
  design: null,               // { params, metrics, features }
  layers: {
    buildings: true,
    landuse: false,
    suitability: true,
    sites: true,
    datacentres: true,
    substations: true,
    design: true,
  },
  agents: {},                 // { [id]: { status, result } }
  constellation: false,
  leftOpen: true,
};

let state = structuredClone(initial);
const subs = new Map();

function fire(key) {
  (subs.get(key) || []).forEach((fn) => fn(state[key], state));
}

export const store = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    Object.keys(patch).forEach(fire);
    fire('*');
  },
  // Shallow-merge into a nested object key, e.g. store.merge('layers', { suitability: false })
  merge(key, patch) {
    store.set({ [key]: { ...state[key], ...patch } });
  },
  // Back to a fresh session, keeping loaded data (candidate sites).
  reset() {
    const { sites } = state;
    store.set({ ...structuredClone(initial), sites });
  },
  on(key, fn) {
    if (!subs.has(key)) subs.set(key, []);
    subs.get(key).push(fn);
    return () => subs.set(key, subs.get(key).filter((f) => f !== fn));
  },
};
