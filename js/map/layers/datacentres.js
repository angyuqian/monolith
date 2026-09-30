// Existing data centres (coral) and grid substations (purple) — the two strongest siting signals.

export async function addInfrastructure(adapter) {
  const { map } = adapter;
  const [dcs, subs] = await Promise.all([
    fetch('data/build/datacentres.geojson').then((r) => r.json()),
    fetch('data/build/substations.geojson').then((r) => r.json()),
  ]);
  map.addSource('dcs', { type: 'geojson', data: dcs });
  map.addSource('subs', { type: 'geojson', data: subs });

  map.addLayer({
    id: 'dc-halo', type: 'circle', source: 'dcs',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 22], 'circle-color': '#e8613c', 'circle-opacity': 0.14, 'circle-pitch-alignment': 'map' },
  });
  map.addLayer({
    id: 'dc-dot', type: 'circle', source: 'dcs',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'circle-color': '#e8613c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'sub-halo', type: 'circle', source: 'subs',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 22], 'circle-color': '#7b5ea7', 'circle-opacity': 0.14, 'circle-pitch-alignment': 'map' },
  });
  map.addLayer({
    id: 'sub-dot', type: 'circle', source: 'subs',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'circle-color': '#7b5ea7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  });
  const label = (id, source, color) => map.addLayer({
    id, type: 'symbol', source, minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11,
      'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 10,
    },
    paint: { 'text-color': color, 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
  });
  label('dc-label', 'dcs', '#c4482a');
  label('sub-label', 'subs', '#5f4589');

  ['dc-dot', 'sub-dot'].forEach((l) => {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  });
  return { dcs, subs };
}

export function syncInfrastructure(map, state) {
  const vis = (on) => (on ? 'visible' : 'none');
  ['dc-halo', 'dc-dot', 'dc-label'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis(state.layers.datacentres)));
  ['sub-halo', 'sub-dot', 'sub-label'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis(state.layers.substations)));
}
