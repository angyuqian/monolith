// App actions: the single place that mutates state + map. Used by UI, the orchestrator and agents (ctx.actions).
import { CONFIG } from '../../config.js';
import { store } from './store.js';
import { bus, EVENTS } from './bus.js';
import { registry } from './registry.js';
import { computeMassing, DEFAULT_PARAMS } from '../design/massing.js';
import { updateDesign } from '../map/layers/design.js';
import { clearParcel } from '../map/layers/buildings.js';
import { cache, cacheKeys } from './cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ISLAND_VIEW = { center: CONFIG.MAP.center, zoom: 11.6, pitch: CONFIG.MAP.pitch, bearing: -8 };

export function createActions(adapter, getCtx) {
  const { map } = adapter;
  let resetEpoch = 0;

  function rebuildDesign(params) {
    const { site } = store.get();
    if (!site) return null;
    const design = computeMassing(site, params);
    store.set({ design });
    updateDesign(map, design);
    clearParcel(map, site, design.params);
    bus.emit(EVENTS.DESIGN_CHANGED, design);
    return design;
  }

  const actions = {
    selectSite(siteOrId, { fly = true } = {}) {
      const { sites } = store.get();
      const site = typeof siteOrId === 'string'
        ? sites.find((s) => s.id === siteOrId || s.name.toLowerCase().includes(siteOrId.toLowerCase()))
        : siteOrId;
      if (!site) return null;
      // A different site starts from the default design (which is what the render cache covers);
      // re-selecting the same site keeps the current edits.
      const sameSite = store.get().site?.id === site.id;
      store.set({ site });
      if (fly) adapter.flyTo({ lng: site.lng, lat: site.lat, zoom: 16.6, pitch: 60, bearing: -28 });
      rebuildDesign(sameSite && store.get().design ? store.get().design.params : DEFAULT_PARAMS);
      bus.emit(EVENTS.SITE_SELECTED, site);
      return site;
    },

    setDesignParams(patch) {
      const current = store.get().design?.params || DEFAULT_PARAMS;
      return rebuildDesign({ ...current, ...patch });
    },

    setStage(stage) {
      store.set({ stage });
    },

    setMode(mode) {
      adapter.setMode(mode);
      store.set({ mode });
    },

    toggleLayer(layer, visible) {
      const layers = store.get().layers;
      if (!(layer in layers)) return false;
      store.merge('layers', { [layer]: visible ?? !layers[layer] });
      return true;
    },

    flyTo(opts) {
      adapter.flyTo(opts);
    },

    // Run any async job under an agent's identity: status pill, constellation link, chat post, result card.
    // Agents use this for secondary actions (e.g. Render's flythrough button).
    //   opts.variant  cache variant, e.g. 'video:dusk' (default 'run'); opts.cache false = never cache
    async runTask(id, fn, fallback, opts = {}) {
      const ctx = getCtx();
      const agent = registry.agent(id);
      const setAgent = (patch) => store.merge('agents', { [id]: { ...store.get().agents[id], ...patch } });
      const { site, design } = store.get();
      const cacheable = opts.cache !== false && agent?.cache !== false;
      const keys = cacheable && cacheKeys({ agentId: id, variant: opts.variant, scope: agent?.cacheScope, site, params: design?.params });
      setAgent({ status: 'running' });
      if (site && !store.get().constellation) store.set({ constellation: true });
      bus.emit(EVENTS.AGENT_STARTED, { id });
      const epoch = resetEpoch;
      const asked = Date.now();
      let result = await cache.get(keys);
      if (result) {
        const [lo, hi] = CONFIG.CACHE?.simulatedDelayMs || [0, 0];
        await sleep(Math.max(0, lo + Math.random() * (hi - lo) - (Date.now() - asked)));
        result.cached = true;
      }
      if (!result) {
        try {
          result = await fn(ctx);
          cache.put(keys, result);
        } catch (err) {
          console.warn(`[agent:${id}]`, err);
          if (CONFIG.DEMO_FALLBACK && fallback) {
            result = { ...(await fallback(ctx)), offline: true };
            ctx.ui.toast(`${agent?.name || id}: Gemini unavailable — showing demo output`, { kind: 'warn' });
          } else {
            result = { status: 'error', summary: err.message || String(err) };
          }
        }
      }
      if (epoch !== resetEpoch) return result; // demo was reset while this was running: drop it
      setAgent({ status: result.status === 'error' ? 'error' : 'done', result });
      bus.emit(EVENTS.AGENT_RESULT, { id, result });
      return result;
    },

    // opts are passed to agent.run(ctx, opts) and agent.cacheVariant(ctx, opts), e.g. { style: 'night' }
    async runAgent(id, opts = {}) {
      const agent = registry.agent(id);
      if (!agent?.run) return null;
      const variant = agent.cacheVariant?.(getCtx(), opts) || 'run';
      return actions.runTask(id, (ctx) => agent.run(ctx, opts), agent.fallback && ((ctx) => agent.fallback(ctx, opts)), { variant });
    },

    // Back to a fresh demo without reloading. The result cache is kept.
    reset() {
      resetEpoch++;
      adapter.orbit(false);
      if (adapter.getMode() === '2d') adapter.setMode('3d');
      store.reset();
      updateDesign(map, null);
      clearParcel(map, null);
      registry.agents().forEach((a) => { try { a.reset?.(getCtx()); } catch (e) { console.warn(`[agent:${a.id}] reset failed`, e); } });
      bus.emit(EVENTS.RESET);
      map.flyTo({ ...ISLAND_VIEW, duration: 2200, essential: true });
    },

    async runAll(stage) {
      const list = registry.agents().filter((a) => a.run && (!stage || a.stage === stage) && !a.manualOnly);
      store.set({ constellation: true });
      return Promise.all(list.map((a) => actions.runAgent(a.id)));
    },
  };
  return actions;
}
