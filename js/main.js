// Boot: map -> data layers -> core services -> agents -> UI.
import { CONFIG } from '../config.js';
import { store } from './core/store.js';
import { bus, EVENTS } from './core/bus.js';
import { registry } from './core/registry.js';
import { gemini } from './core/gemini.js';
import { createActions } from './core/actions.js';
import { cache } from './core/cache.js';
import { createOrchestrator } from './core/orchestrator.js';
import { createMap } from './map/MapAdapter.js';
import { addBuildings, syncBuildings, buildingPopupHTML } from './map/layers/buildings.js';
import { addInfrastructure, syncInfrastructure } from './map/layers/datacentres.js';
import { addSuitability, addSiteMarkers, syncSuitability, cellToSite } from './map/layers/suitability.js';
import { addDesignLayers, syncDesign } from './map/layers/design.js';
import { computeMassing } from './design/massing.js';
import { initShell } from './ui/shell.js';
import { initMapControls } from './ui/mapControls.js';
import { initLeftPanel } from './ui/leftPanel.js';
import { initAgentHub } from './ui/agentHub.js';
import { initAgentOverlay } from './ui/agentOverlay.js';
import { toast, lightbox } from './ui/toast.js';
import { AGENTS } from '../agents/index.js';

const status = (t) => { document.getElementById('loader-status').textContent = t; };

async function loadAgents() {
  for (const file of AGENTS) {
    try {
      const mod = await import(new URL(`../agents/${file}`, import.meta.url).href);
      registry.registerAgent(mod.default);
    } catch (e) {
      console.error(`[agents] failed to load ${file}`, e); // a broken agent never takes the app down
    }
  }
}

function initClickRouter(adapter, actions) {
  const { map } = adapter;
  const popup = new maplibregl.Popup({ closeButton: false, offset: 10 });
  const order = ['dc-dot', 'sub-dot', 'design-3d', 'design-2d', 'suit-fill', 'bld-3d', 'bld-2d'];
  bus.on(EVENTS.RESET, () => popup.remove());
  map.on('click', (e) => {
    const layers = order.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures(e.point, { layers });
    if (!hits.length) return popup.remove();
    const f = hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id))[0];
    const id = f.layer.id;
    if (id === 'dc-dot' || id === 'sub-dot') {
      popup.setLngLat(f.geometry.coordinates)
        .setHTML(`<div class="pop__title">${f.properties.name}</div><div class="pop__meta">${id === 'dc-dot' ? 'Existing data centre' : 'Grid substation'}</div>`).addTo(map);
    } else if (id.startsWith('design')) {
      popup.setLngLat(e.lngLat).setHTML(`<div class="pop__title">${f.properties.label || f.properties.kind}</div><div class="pop__meta">Proposed · ${f.properties.h} m</div>`).addTo(map);
    } else if (id === 'suit-fill' && store.get().stage !== 'review') {
      popup.remove();
      const known = store.get().sites.find((s) => s.cellId === f.properties.id);
      actions.selectSite(known || cellToSite(f.properties));
    } else if (id.startsWith('bld')) {
      popup.setLngLat(e.lngLat).setHTML(buildingPopupHTML(f.properties)).addTo(map);
    }
  });
}

async function boot() {
  status('Loading basemap…');
  const adapter = await createMap('map', CONFIG.MAP);
  const { map } = adapter;

  status('Loading siting data…');
  const sites = await fetch('data/build/sites.json').then((r) => r.json());
  store.set({ sites });
  await addSuitability(adapter);
  await addInfrastructure(adapter);
  await addBuildings(adapter, status);
  addDesignLayers(adapter);
  const cached = await cache.init();
  if (cached) console.info(`[cache] ${cached} pre-rendered results from data/cache/`);

  // shared context handed to every agent + UI module
  let ctx;
  const actions = createActions(adapter, () => ctx);
  ctx = {
    store, bus, registry, gemini, actions, cache,
    map: adapter,
    massing: computeMassing,
    ui: {
      toast, lightbox, ask: () => {},
      slots: { command: document.getElementById('command-slot'), stage: document.getElementById('map-stage') },
    },
    getSite: () => store.get().site,
    getDesign: () => store.get().design,
    snapshot: (opts) => adapter.snapshot(opts),
  };
  window.monolith = ctx; // handy for teammates in the devtools console

  status('Waking up agents…');
  await loadAgents();
  const orchestrator = createOrchestrator(() => ctx);
  ctx.orchestrator = orchestrator;

  addSiteMarkers(adapter, sites, (site) => actions.selectSite(site));
  initShell(ctx);
  initMapControls(ctx);
  initLeftPanel(ctx);
  initAgentHub(ctx, orchestrator);
  initAgentOverlay(ctx);
  // agents that add UI outside their hub card (e.g. the voice mic in the command bar)
  registry.agents().forEach((a) => { try { a.init?.(ctx); } catch (e) { console.error(`[agent:${a.id}] init failed`, e); } });
  initClickRouter(adapter, actions);

  const syncMap = () => {
    const s = store.get();
    syncBuildings(map, s);
    syncInfrastructure(map, s);
    syncSuitability(map, s);
    syncDesign(map, s);
  };
  store.on('*', syncMap);
  syncMap();

  bus.emit(EVENTS.MAP_READY, ctx);
  document.getElementById('loader').classList.add('is-done');
  // gentle intro drift
  map.easeTo({ zoom: 11.6, bearing: -8, duration: 4000 });
}

boot().catch((e) => {
  console.error(e);
  status(`Failed to start: ${e.message}`);
});
