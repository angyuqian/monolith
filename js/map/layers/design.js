// Proposed data-centre massing (from js/design/massing.js) with dimension lines and labels.
const EMPTY = { type: 'FeatureCollection', features: [] };

export function addDesignLayers(adapter) {
  const { map } = adapter;
  map.addSource('design-masses', { type: 'geojson', data: EMPTY });
  map.addSource('design-lines', { type: 'geojson', data: EMPTY });
  map.addSource('design-labels', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'design-parcel', type: 'fill', source: 'design-masses',
    filter: ['==', ['get', 'kind'], 'parcel'],
    paint: { 'fill-color': '#dfead7', 'fill-opacity': 0.95 },
  });
  map.addLayer({
    id: 'design-2d', type: 'fill', source: 'design-masses',
    filter: ['!=', ['get', 'kind'], 'parcel'],
    layout: { visibility: 'none' },
    paint: { 'fill-color': ['get', 'color'], 'fill-outline-color': '#ffffff' },
  });
  map.addLayer({
    id: 'design-3d', type: 'fill-extrusion', source: 'design-masses',
    filter: ['!=', ['get', 'kind'], 'parcel'],
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  map.addLayer({
    id: 'design-lines', type: 'line', source: 'design-lines',
    paint: {
      'line-color': ['match', ['get', 'kind'], 'parcel', '#e8613c', '#c4482a'],
      'line-width': ['match', ['get', 'kind'], 'parcel', 2, 1.2],
      'line-dasharray': [3, 2],
    },
  });
  map.addLayer({
    id: 'design-labels', type: 'symbol', source: 'design-labels',
    layout: {
      'text-field': ['get', 'text'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['match', ['get', 'kind'], 'tag', 12, 11.5],
      'text-allow-overlap': true,
      'text-padding': 0,
    },
    paint: {
      'text-color': ['match', ['get', 'kind'], 'tag', '#1d1c1a', '#c4482a'],
      'text-halo-color': '#ffffff',
      'text-halo-width': ['match', ['get', 'kind'], 'tag', 4, 2],
    },
  });
}

export function updateDesign(map, design) {
  const g = design?.geojson;
  map.getSource('design-masses').setData(g?.masses || EMPTY);
  map.getSource('design-lines').setData(g?.lines || EMPTY);
  map.getSource('design-labels').setData(g?.labels || EMPTY);
}

export function syncDesign(map, state) {
  const on = state.layers.design && !!state.design;
  const is3d = state.mode === '3d';
  const vis = (v) => (v ? 'visible' : 'none');
  map.setLayoutProperty('design-parcel', 'visibility', vis(on));
  map.setLayoutProperty('design-3d', 'visibility', vis(on && is3d));
  map.setLayoutProperty('design-2d', 'visibility', vis(on && !is3d));
  map.setLayoutProperty('design-lines', 'visibility', vis(on));
  map.setLayoutProperty('design-labels', 'visibility', vis(on));
}
