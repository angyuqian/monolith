// Floating map chrome: bottom control bar (zoom, 2D/3D, orbit, compass, photoreal), layers popover, legend.
import { store } from '../core/store.js';
import { LEGEND } from '../map/layers/buildings.js';
import { photorealAvailable, openPhotoreal, closePhotoreal, isPhotorealOpen } from '../map/google3d.js';

const ICON = {
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  orbit: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  compass: '<svg viewBox="0 0 24 24"><path d="m12 3 4 9h-8l4-9Z" fill="#e8613c" stroke="#e8613c"/><path d="m12 21-4-9h8l-4 9Z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>',
};

const LAYER_ROWS = [
  ['buildings', 'Buildings', '#e7e3db'],
  ['landuse', 'Colour by land use', '#b7a5d8'],
  ['suitability', 'Suitability grid', '#ee865f'],
  ['sites', 'Candidate sites', '#e8613c'],
  ['datacentres', 'Existing data centres', '#e8613c'],
  ['substations', 'Grid substations', '#7b5ea7'],
  ['design', 'Proposed design', '#f3d9a4'],
];

export function initMapControls(ctx) {
  const { map: adapter, actions } = ctx;
  const { map } = adapter;
  const bar = document.getElementById('map-controls');
  bar.innerHTML = `
    <button class="icon-btn" data-act="home" title="Island view">${ICON.home}</button>
    <button class="icon-btn" data-act="zoom-out" title="Zoom out">${ICON.minus}</button>
    <button class="icon-btn" data-act="zoom-in" title="Zoom in">${ICON.plus}</button>
    <span class="divider"></span>
    <div class="mode-toggle"><button data-mode="2d">2D</button><button data-mode="3d">3D</button></div>
    <span class="divider"></span>
    <button class="icon-btn" data-act="orbit" title="Orbit (O)">${ICON.orbit}</button>
    <button class="icon-btn compass" data-act="north" title="Reset north">${ICON.compass}</button>
    ${photorealAvailable() ? `<span class="divider"></span><button class="icon-btn" data-act="photoreal" title="Google Photorealistic 3D">${ICON.globe}</button>` : ''}
  `;
  bar.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return actions.setMode(m.dataset.mode);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'zoom-in') map.zoomIn();
    if (act === 'zoom-out') map.zoomOut();
    if (act === 'north') map.easeTo({ bearing: 0, duration: 600 });
    if (act === 'orbit') adapter.orbit(!adapter.isOrbiting());
    if (act === 'home') adapter.home();
    if (act === 'photoreal') {
      if (isPhotorealOpen()) { closePhotoreal(); b.classList.remove('is-active'); return; }
      try {
        const parcel = store.get().design?.geojson.lines.features[0]?.geometry.coordinates;
        await openPhotoreal(document.getElementById('map-stage'), adapter.getView(), { parcel });
        b.classList.add('is-active');
      } catch (err) {
        ctx.ui.toast(`Photoreal unavailable: ${err.message}`, { kind: 'warn' });
      }
    }
  });
  adapter._onOrbit = (on) => bar.querySelector('[data-act=orbit]').classList.toggle('is-active', on);
  const compass = bar.querySelector('.compass svg');
  map.on('rotate', () => { compass.style.transform = `rotate(${-map.getBearing()}deg)`; });

  // layers popover
  const pop = document.getElementById('layers-pop');
  pop.innerHTML = `<div class="layers-pop__title">Layers <span class="muted mono" style="font-size:11px">L</span></div>
    ${LAYER_ROWS.map(([k, label, c]) => `<div class="layer-row" data-layer="${k}"><span class="layer-row__sw" style="background:${c}"></span><span class="layer-row__label">${label}</span><span class="switch"></span></div>`).join('')}`;
  pop.addEventListener('click', (e) => {
    const row = e.target.closest('[data-layer]');
    if (row) actions.toggleLayer(row.dataset.layer);
  });

  // legend
  const legend = document.getElementById('legend');

  function sync() {
    const s = store.get();
    bar.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === s.mode));
    pop.querySelectorAll('[data-layer]').forEach((r) => r.querySelector('.switch').classList.toggle('is-on', !!s.layers[r.dataset.layer]));
    const showUse = s.mode === '2d' || s.layers.landuse;
    let html = '';
    if (s.layers.suitability) {
      html += `<div class="legend__title">Site suitability</div><div class="legend__ramp"></div><div class="legend__ramp-labels"><span>40</span><span>70</span><span>100</span></div>`;
    }
    if (showUse && s.layers.buildings) {
      html += `<div class="legend__title" style="margin-top:${s.layers.suitability ? 10 : 0}px">Land use</div>${LEGEND.map(([l, c]) => `<div class="legend__row"><span class="legend__sw" style="background:${c}"></span>${l}</div>`).join('')}`;
    } else {
      html += `<div class="legend__title" style="margin-top:${s.layers.suitability ? 10 : 0}px">Infrastructure</div>
        <div class="legend__row"><span class="legend__sw" style="background:#e8613c;border-radius:50%"></span>Existing data centre</div>
        <div class="legend__row"><span class="legend__sw" style="background:#7b5ea7;border-radius:50%"></span>Grid substation</div>`;
    }
    legend.innerHTML = html;
    legend.hidden = !html;
  }
  store.on('*', sync);
  sync();
}
