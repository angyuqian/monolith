// Map abstraction. UI, layers and agents only use this surface, so the renderer can be swapped
// (MapLibre today; Google Photoreal 3D via js/map/google3d.js when a Maps key is configured).
//
// interface MapAdapter {
//   map                                   raw renderer instance (escape hatch; MapLibre for now)
//   flyTo({ lng, lat, zoom?, pitch?, bearing?, duration? })
//   setMode('2d' | '3d')
//   getMode()
//   project([lng, lat]) -> { x, y }       screen px relative to the map container
//   snapshot({ maxWidth? }) -> dataURL    JPEG of the current view (for Gemini image/Omni input)
//   orbit(on: boolean)                    cinematic auto-rotate
//   on(event, fn)                         'move' | 'click' | 'load' | 'mode'
//   getView() -> { lng, lat, zoom, pitch, bearing }
//   beforeLabels                          layer id to insert 3D layers under basemap labels
// }
import { createMapLibreAdapter } from './maplibre.js';

export async function createMap(container, config) {
  return createMapLibreAdapter(container, config);
}
