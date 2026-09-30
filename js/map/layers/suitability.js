// Suitability grid (250m cells scored 0–100 by scripts/prep_data.py) + lettered candidate-site markers.

const RAMP = ['interpolate', ['linear'], ['get', 'score'], 40, '#fbe7dc', 60, '#f5b597', 78, '#ee865f', 92, '#e05530'];
let markers = [];
let hoverId = null;

export async function addSuitability(adapter) {
  const { map } = adapter;
  const grid = await fetch('data/build/suitability.geojson').then((r) => r.json());
  map.addSource('suit', { type: 'geojson', data: grid, promoteId: 'id' });
  map.addLayer({
    id: 'suit-fill', type: 'fill', source: 'suit',
    paint: {
      'fill-color': RAMP,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'],
        11, ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.62],
        14.5, ['case', ['boolean', ['feature-state', 'hover'], false], 0.75, 0.4],
        16, ['case', ['boolean', ['feature-state', 'hover'], false], 0.4, 0.14]],
    },
  }, adapter.beforeLabels);
  map.addLayer({
    id: 'suit-selected', type: 'line', source: 'suit',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#e8613c', 'line-width': 2.5 },
  }, adapter.beforeLabels);

  map.on('mousemove', 'suit-fill', (e) => {
    const id = e.features[0].id;
    if (id === hoverId) return;
    if (hoverId != null) map.setFeatureState({ source: 'suit', id: hoverId }, { hover: false });
    hoverId = id;
    map.setFeatureState({ source: 'suit', id }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'suit-fill', () => {
    if (hoverId != null) map.setFeatureState({ source: 'suit', id: hoverId }, { hover: false });
    hoverId = null;
    map.getCanvas().style.cursor = '';
  });
  return grid;
}

// Turn a clicked grid cell into a site object (same shape as sites.json entries).
export function cellToSite(props) {
  return {
    id: props.id,
    cellId: props.id,
    name: `Custom site · cell ${props.id.slice(1).replace('_', '-')}`,
    lng: props.cx,
    lat: props.cy,
    score: props.score,
    breakdown: { land: props.land, power: props.power, fibre: props.fibre, community: props.community },
    nearestSubstation: { name: 'Nearest substation', distanceM: props.dSub },
    nearestDataCentre: { name: 'Nearest data centre', distanceM: props.dDc },
    custom: true,
  };
}

export function addSiteMarkers(adapter, sites, onSelect) {
  markers.forEach((m) => m.marker.remove());
  markers = sites.map((site, i) => {
    const el = document.createElement('div');
    el.className = 'site-marker';
    el.innerHTML = `<div class="site-marker__bubble">${String.fromCharCode(65 + i)}</div><div class="site-marker__stem"></div>`;
    el.title = `${site.name} — score ${site.score}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(site); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([site.lng, site.lat]).addTo(adapter.map);
    return { marker, el, site };
  });
}

export function syncSuitability(map, state) {
  const vis = state.layers.suitability ? 'visible' : 'none';
  map.setLayoutProperty('suit-fill', 'visibility', vis);
  map.setLayoutProperty('suit-selected', 'visibility', vis);
  map.setFilter('suit-selected', ['==', ['get', 'id'], state.site?.cellId || '']);
  markers.forEach(({ el, site }) => {
    const active = state.site?.id === site.id;
    el.style.display = state.layers.sites && !(active && state.design) ? '' : 'none'; // parcel replaces the pin
    el.classList.toggle('is-active', active);
  });
}
