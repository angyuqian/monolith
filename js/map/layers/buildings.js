// Singapore building footprints (data/build/buildings.*.json, compact encoding from scripts/prep_data.py).
// 3D: near-white extrusions (optionally tinted by land use). 2D: flat plan coloured by land use.

export const ARCHETYPE_COLORS = {
  data_centre: '#e8613c',
  industrial: '#e9b454',
  business_park: '#e39b5a',
  hdb: '#b7a5d8',
  private_apartment: '#c9b8e5',
  landed_property: '#e3daf0',
  mixed_development: '#d7a8c8',
  shophouse: '#f1a79d',
  retail: '#f1a79d',
  restaurant: '#f1a79d',
  hawker_centre: '#f1a79d',
  office: '#9db7e0',
  hotel: '#9db7e0',
  community_cultural: '#a9cfa0',
  ihl: '#a9cfa0',
  non_ihl: '#a9cfa0',
  hospital: '#a9cfa0',
  clinic: '#a9cfa0',
  nursing_home: '#a9cfa0',
  sports: '#a9cfa0',
};

export const LEGEND = [
  ['Data centre', '#e8613c'],
  ['Industrial', '#e9b454'],
  ['Business park', '#e39b5a'],
  ['Public housing', '#b7a5d8'],
  ['Private residential', '#d6c9ec'],
  ['Commercial', '#f1a79d'],
  ['Office / hotel', '#9db7e0'],
  ['Civic / education', '#a9cfa0'],
];

const LAYERS = ['bld-2d', 'bld-2d-line', 'bld-3d'];
let centroids = []; // [lng, lat] per feature id — used to hide buildings under the proposed parcel
let hiddenIds = [];

function landuseColor() {
  const pairs = Object.entries(ARCHETYPE_COLORS).flat();
  return ['match', ['get', 'a'], ...pairs, '#dcd8d0'];
}
function neutralColor() {
  return ['match', ['get', 'a'],
    'data_centre', '#ef8a68',
    'industrial', '#efe9df', 'business_park', '#efe9df',
    '#f7f6f3'];
}

export function decode(data, idOffset = 0) {
  const { origin: [ox, oy], scale, arch, f } = data;
  const features = new Array(f.length);
  for (let k = 0; k < f.length; k++) {
    const [h, ai, name, polys] = f[k];
    const coords = polys.map((rings) => rings.map((flat) => {
      const ring = [];
      let x = ox;
      let y = oy;
      for (let i = 0; i < flat.length; i += 2) {
        x += flat[i] / scale;
        y += flat[i + 1] / scale;
        ring.push([x, y]);
      }
      ring.push(ring[0]);
      return ring;
    }));
    const outer = coords[0][0];
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < outer.length - 1; i++) { cx += outer[i][0]; cy += outer[i][1]; }
    const n = Math.max(1, outer.length - 1);
    centroids[idOffset + k] = [cx / n, cy / n];
    const props = { h, a: arch[ai] };
    if (name) props.n = name;
    features[k] = {
      type: 'Feature',
      id: idOffset + k,
      geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords },
      properties: props,
    };
  }
  return features;
}

export async function addBuildings(adapter, onStatus = () => {}) {
  const { map } = adapter;
  onStatus('Loading 62,628 buildings…');
  const core = await fetch('data/build/buildings.core.json').then((r) => r.json());
  onStatus('Building city model…');
  const features = decode(core, 0);
  map.addSource('buildings', { type: 'geojson', data: { type: 'FeatureCollection', features }, buffer: 64, tolerance: 0.3 });

  map.addLayer({
    id: 'bld-2d', type: 'fill', source: 'buildings',
    layout: { visibility: 'none' },
    paint: { 'fill-color': landuseColor(), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 0.9] },
  }, adapter.beforeLabels);
  map.addLayer({
    id: 'bld-2d-line', type: 'line', source: 'buildings', minzoom: 14,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': 0.6 },
  }, adapter.beforeLabels);
  map.addLayer({
    id: 'bld-3d', type: 'fill-extrusion', source: 'buildings',
    paint: {
      'fill-extrusion-color': neutralColor(),
      'fill-extrusion-height': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, ['get', 'h']],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.94,
      'fill-extrusion-vertical-gradient': true,
    },
  }, adapter.beforeLabels);

  // landed houses (56k) load after first paint
  setTimeout(async () => {
    try {
      const landed = await fetch('data/build/buildings.landed.json').then((r) => r.json());
      const more = decode(landed, features.length);
      map.getSource('buildings').setData({ type: 'FeatureCollection', features: features.concat(more) });
    } catch (e) {
      console.warn('landed buildings failed to load', e);
    }
  }, 1500);
}

export function syncBuildings(map, state) {
  const on = state.layers.buildings;
  const is3d = state.mode === '3d';
  map.setLayoutProperty('bld-3d', 'visibility', on && is3d ? 'visible' : 'none');
  map.setLayoutProperty('bld-2d', 'visibility', on && !is3d ? 'visible' : 'none');
  map.setLayoutProperty('bld-2d-line', 'visibility', on && !is3d ? 'visible' : 'none');
  map.setPaintProperty('bld-3d', 'fill-extrusion-color', state.layers.landuse ? landuseColor() : neutralColor());
}

// Flatten existing buildings whose centroid falls inside the proposed parcel (rotated rectangle).
export function clearParcel(map, site, params) {
  hiddenIds.forEach((id) => map.setFeatureState({ source: 'buildings', id }, { hidden: false }));
  hiddenIds = [];
  if (!site || !params) return;
  const mLon = 111320 * Math.cos((site.lat * Math.PI) / 180);
  const mLat = 110574;
  const th = (params.rotation * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const hw = params.parcelW / 2 + 4;
  const hd = params.parcelD / 2 + 4;
  const r = Math.hypot(hw, hd);
  for (let id = 0; id < centroids.length; id++) {
    const c = centroids[id];
    if (!c) continue;
    const dx = (c[0] - site.lng) * mLon;
    const dy = (c[1] - site.lat) * mLat;
    if (Math.abs(dx) > r || Math.abs(dy) > r) continue;
    const x = dx * cos - dy * sin;
    const y = dx * sin + dy * cos;
    if (Math.abs(x) <= hw && Math.abs(y) <= hd) {
      map.setFeatureState({ source: 'buildings', id }, { hidden: true });
      hiddenIds.push(id);
    }
  }
}

export const BUILDING_LAYERS = LAYERS;

export function buildingPopupHTML(p) {
  const kind = String(p.a).replace(/_/g, ' ');
  return `<div class="pop__title">${p.n || kind}</div><div class="pop__meta">${kind} · ${p.h} m</div>`;
}
