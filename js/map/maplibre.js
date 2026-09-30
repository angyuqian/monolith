// MapLibre GL implementation of the MapAdapter interface (see MapAdapter.js).
/* global maplibregl */

const BEFORE_LABELS = 'waterway_line_label';
const PITCH_3D = 58;

function styleBasemap(map) {
  const paint = (id, prop, val) => map.getLayer(id) && map.setPaintProperty(id, prop, val);
  paint('background', 'background-color', '#f4f3ef');
  paint('water', 'fill-color', '#d5dfe4');
  paint('park', 'fill-color', '#e3ebdc');
  paint('landcover_wood', 'fill-color', '#dfe8d8');
  paint('landuse_residential', 'fill-color', '#efeee9');
  if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none'); // we draw our own
}

export function createMapLibreAdapter(container, config) {
  return new Promise((resolve, reject) => {
    const map = new maplibregl.Map({
      container,
      style: config.style,
      center: config.center,
      zoom: config.zoom,
      pitch: config.pitch,
      bearing: config.bearing,
      maxPitch: 75,
      antialias: true,
      preserveDrawingBuffer: true, // needed for snapshot()
      attributionControl: false,
    });
    map.on('error', (e) => console.warn('[map]', e.error?.message || e));

    let mode = '3d';
    let orbiting = false;
    let rafId = null;
    const listeners = { mode: [] };

    const stopOrbit = () => {
      orbiting = false;
      cancelAnimationFrame(rafId);
      adapter._onOrbit?.(false);
    };
    ['mousedown', 'wheel', 'touchstart', 'dragstart'].forEach((ev) => map.on(ev, () => orbiting && stopOrbit()));

    const adapter = {
      map,
      beforeLabels: BEFORE_LABELS,

      flyTo({ lng, lat, zoom = 16, pitch, bearing, duration = 2600 }) {
        map.flyTo({
          center: [lng, lat],
          zoom,
          pitch: mode === '2d' ? 0 : pitch ?? PITCH_3D,
          bearing: mode === '2d' ? 0 : bearing ?? map.getBearing(),
          duration,
          essential: true,
          curve: 1.5,
        });
      },

      setMode(next) {
        if (next === mode) return;
        mode = next;
        if (mode === '2d') stopOrbit();
        // Camera change waits for any flight in progress (e.g. select site + "show it in 2D"),
        // otherwise easeTo would cancel the fly-in halfway.
        const applyCamera = () => {
          if (mode === '2d') {
            map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
            map.setMaxPitch(0);
            map.dragRotate.disable();
            map.touchZoomRotate.disableRotation();
          } else {
            map.setMaxPitch(75);
            map.dragRotate.enable();
            map.touchZoomRotate.enableRotation();
            map.easeTo({ pitch: PITCH_3D, bearing: -18, duration: 1100 });
          }
        };
        if (map.isMoving() && !orbiting) map.once('moveend', applyCamera);
        else applyCamera();
        listeners.mode.forEach((fn) => fn(mode));
      },
      getMode: () => mode,

      project([lng, lat]) {
        return map.project([lng, lat]);
      },

      // aspect: optional centre crop (e.g. 16/9) — image/video models follow the input's shape
      snapshot({ maxWidth = 1280, aspect } = {}) {
        const src = map.getCanvas();
        let sw = src.width;
        let sh = src.height;
        if (aspect) {
          sh = Math.min(src.height, sw / aspect);
          sw = sh * aspect;
        }
        const sx = (src.width - sw) / 2;
        const sy = (src.height - sh) / 2;
        const scale = Math.min(1, maxWidth / sw);
        const c = document.createElement('canvas');
        c.width = Math.round(sw * scale);
        c.height = Math.round(sh * scale);
        c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.86);
      },

      // Snapshot without text labels / annotation lines (for image models), then restore visibility.
      // Hidden layers are only off for ~2 frames, so it's safe to call in the background.
      async cleanSnapshot({ hide = [], maxWidth, aspect } = {}) {
        while (map.isMoving() && !orbiting) await new Promise((r) => map.once('moveend', r));
        const ids = map.getStyle().layers.filter((l) => l.type === 'symbol' || hide.includes(l.id)).map((l) => l.id);
        const prev = ids.map((id) => [id, map.getLayoutProperty(id, 'visibility') || 'visible']);
        ids.forEach((id) => map.setLayoutProperty(id, 'visibility', 'none'));
        const frame = () => new Promise((r) => { map.once('render', r); map.triggerRepaint(); setTimeout(r, 400); });
        await frame();
        await frame();
        const shot = adapter.snapshot({ maxWidth, aspect });
        prev.forEach(([id, v]) => map.setLayoutProperty(id, 'visibility', v));
        return shot;
      },

      orbit(on) {
        if (!on) return stopOrbit();
        if (mode === '2d') adapter.setMode('3d');
        orbiting = true;
        adapter._onOrbit?.(true);
        const step = () => {
          if (!orbiting) return;
          map.setBearing(map.getBearing() + 0.06);
          rafId = requestAnimationFrame(step);
        };
        step();
      },
      isOrbiting: () => orbiting,

      on(event, fn) {
        if (event === 'mode') listeners.mode.push(fn);
        else map.on(event, fn);
      },

      getView() {
        const c = map.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      },
    };

    map.once('load', () => {
      styleBasemap(map);
      map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.28, position: [1.4, 200, 35] });
      resolve(adapter);
    });
    setTimeout(() => reject(new Error('Map failed to load (network?)')), 20000);
  });
}
