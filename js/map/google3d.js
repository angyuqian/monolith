// Optional Google Photorealistic 3D view (Maps JavaScript API <gmp-map-3d>).
// Only offered when CONFIG.GOOGLE_MAPS_KEY is set ("AIza..." key with Maps JavaScript API + Map Tiles API).
// Opens as an overlay synced to the MapLibre camera; closing returns to the analytic map.
import { CONFIG } from '../../config.js';

let loading = null;
let el = null;

export const photorealAvailable = () => !!CONFIG.GOOGLE_MAPS_KEY;

function loadMapsJS() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_KEY}&v=alpha&libraries=maps3d`;
    s.async = true;
    s.onload = () => google.maps.importLibrary('maps3d').then(resolve, reject);
    s.onerror = () => reject(new Error('Google Maps JS failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}

export async function openPhotoreal(container, view, site) {
  await loadMapsJS();
  const { Map3DElement, Polygon3DElement } = await google.maps.importLibrary('maps3d');
  el = new Map3DElement({
    center: { lat: view.lat, lng: view.lng, altitude: 0 },
    range: 40000000 / 2 ** view.zoom,
    tilt: Math.min(view.pitch + 10, 75),
    heading: view.bearing,
    mode: 'HYBRID',
  });
  el.style.cssText = 'position:absolute;inset:0;z-index:2;';
  if (site?.parcel) {
    const poly = new Polygon3DElement({
      strokeColor: '#E8613C', strokeWidth: 3, fillColor: 'rgba(232,97,60,0.25)',
      altitudeMode: 'CLAMP_TO_GROUND',
    });
    poly.outerCoordinates = site.parcel.map(([lng, lat]) => ({ lat, lng }));
    el.append(poly);
  }
  container.appendChild(el);
  return el;
}

export function closePhotoreal() {
  el?.remove();
  el = null;
}

export const isPhotorealOpen = () => !!el;
