// Parametric data-centre massing: params + site centre -> GeoJSON features + engineering metrics.
// Pure (no DOM, no map) so agents and teammates can call it directly.

export const DEFAULT_PARAMS = {
  itMW: 60,            // critical IT load
  halls: 4,            // data halls side by side
  storeys: 2,
  cooling: 'liquid',   // 'liquid' | 'air'
  redundancy: 'N+1',   // 'N+1' | '2N'
  rotation: 0,         // degrees clockwise
  parcelW: 240,        // parcel width (m)
  parcelD: 170,        // parcel depth (m)
};

export const PARAM_LIMITS = {
  itMW: [5, 120, 5],
  halls: [1, 8, 1],
  storeys: [1, 6, 1],
  rotation: [-90, 90, 1],
  parcelW: [120, 400, 10],
  parcelD: [100, 300, 10],
};

const SETBACK = 12;
const YARD_W = 30;
const FLOOR_H = 6;
const SG_GRID_EF = 0.4168; // kgCO2/kWh, EMA 2023

export const COLORS = {
  parcel: '#dfead7',
  hall: '#f3d9a4',
  core: '#e6c486',
  admin: '#8fa8db',
  substation: '#9b86c4',
  generator: '#8a8680',
  cooling: '#a9c8e6',
};

export function computeMassing(site, input = {}) {
  const p = { ...DEFAULT_PARAMS, ...input };
  const warnings = [];
  const liquid = p.cooling === 'liquid';

  // ---- engineering -------------------------------------------------------
  const kWPerM2 = liquid ? 4.0 : 1.6;       // white-space power density
  const rackKW = liquid ? 45 : 12;
  const supportRatio = 1.55;                 // gross floor / white space
  const whiteReq = (p.itMW * 1000) / kWPerM2;
  const footReq = (whiteReq / p.storeys) * supportRatio;

  const availD = p.parcelD - 2 * SETBACK;
  const adminW = 18;
  const mainX0 = -p.parcelW / 2 + SETBACK;
  const mainX1 = p.parcelW / 2 - SETBACK - YARD_W - 8;
  const mainW = mainX1 - mainX0;
  const hallsW = mainW - adminW - 4;
  let mainD = footReq / hallsW;
  let itAchieved = p.itMW;
  if (mainD > availD) {
    mainD = availD;
    const whiteAch = ((hallsW * mainD) / supportRatio) * p.storeys;
    itAchieved = Math.floor((whiteAch * kWPerM2) / 1000);
    warnings.push(`Parcel fits ${itAchieved} MW at ${p.storeys} storey${p.storeys > 1 ? "s" : ""} — add storeys, switch to liquid cooling, or enlarge the parcel.`);
  }
  mainD = Math.max(mainD, 40);

  let pue = liquid ? 1.18 : 1.38;
  if (p.redundancy === '2N') pue += 0.03;
  const facilityMW = itAchieved * pue;
  const energyGWh = (itAchieved * pue * 8760 * 0.8) / 1000;
  const wue = liquid ? 0.2 : 1.6;
  const waterM3 = (energyGWh * 1e6 * wue) / 1000;
  const carbonT = (energyGWh * 1e6 * SG_GRID_EF) / 1000;
  const gensN = Math.ceil(facilityMW / 2.5);
  const gensets = p.redundancy === '2N' ? gensN * 2 : gensN + Math.ceil(gensN / 6);
  const hallH = p.storeys * FLOOR_H;
  const heightM = hallH + 3.5;

  // ---- geometry (local metres, x east / y north, centred on site) ---------
  const polys = [];
  const add = (kind, x0, y0, x1, y1, h, base = 0, extra = {}) =>
    polys.push({ kind, rect: [x0, y0, x1, y1], h, base, ...extra });

  add('parcel', -p.parcelW / 2, -p.parcelD / 2, p.parcelW / 2, p.parcelD / 2, 0.4);

  const y0 = -mainD / 2;
  const y1 = mainD / 2;
  add('admin', mainX0, y0 + 6, mainX0 + adminW, y1 - 6, 13.5);
  const hallGap = 4;
  const hx0 = mainX0 + adminW + 4;
  const hallW = (hallsW - hallGap * (p.halls - 1)) / p.halls;
  for (let i = 0; i < p.halls; i++) {
    const a = hx0 + i * (hallW + hallGap);
    add('hall', a, y0, a + hallW, y1, hallH, 0, { label: `Hall ${i + 1}` });
    if (i < p.halls - 1) add('core', a + hallW, y0 + 8, a + hallW + hallGap, y1 - 8, hallH - 1.5);
    // rooftop cooling plant rows
    const rows = liquid ? 2 : 3;
    const rowW = Math.min(4, (hallW - 6) / (rows * 2));
    for (let r = 0; r < rows; r++) {
      const cx = a + ((r + 1) * hallW) / (rows + 1);
      add('cooling', cx - rowW / 2, y0 + 6, cx + rowW / 2, y1 - 6, hallH + 3.5, hallH);
    }
  }

  // service yard: substation + generator farm
  const yx0 = p.parcelW / 2 - SETBACK - YARD_W;
  const yx1 = p.parcelW / 2 - SETBACK;
  const yTop = p.parcelD / 2 - SETBACK;
  add('substation', yx0, yTop - 30, yx1, yTop, 9);
  const genTop = yTop - 36;
  const genBottom = -p.parcelD / 2 + SETBACK;
  const rowsFit = Math.max(0, Math.floor((genTop - genBottom) / 5.5));
  const drawn = Math.min(gensets, rowsFit * 2);
  if (drawn < gensets) warnings.push(`Only ${drawn} of ${gensets} gensets fit in the service yard.`);
  for (let i = 0; i < drawn; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const gx = yx0 + col * 16;
    const gy = genTop - row * 5.5;
    add('generator', gx, gy - 3.5, gx + 13, gy, 4);
  }

  // ---- project to lng/lat --------------------------------------------------
  const { lng: cx, lat: cy } = site;
  const mLon = 111320 * Math.cos((cy * Math.PI) / 180);
  const mLat = 110574;
  const th = (-p.rotation * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const toLL = (x, y) => [cx + (x * cos - y * sin) / mLon, cy + (x * sin + y * cos) / mLat];
  const ring = ([x0, y0, x1, y1]) => [toLL(x0, y0), toLL(x1, y0), toLL(x1, y1), toLL(x0, y1), toLL(x0, y0)];

  const features = polys.map((q) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring(q.rect)] },
    properties: { kind: q.kind, h: q.h, base: q.base, color: COLORS[q.kind], label: q.label || '' },
  }));

  const W = p.parcelW / 2;
  const D = p.parcelD / 2;
  const lines = [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: ring([-W, -D, W, D]) }, properties: { kind: 'parcel' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: ring([mainX0, y0, mainX1, y1]) }, properties: { kind: 'building' } },
  ];
  const label = (x, y, text, kind = 'dim') => ({ type: 'Feature', geometry: { type: 'Point', coordinates: toLL(x, y) }, properties: { text, kind } });
  const labels = [
    label(0, -D - 7, `${p.parcelW.toFixed(1)} m`),
    label(-W - 9, 0, `${p.parcelD.toFixed(1)} m`),
    label((mainX0 + mainX1) / 2, y1 + 6, `${mainW.toFixed(1)} m`),
    label(mainX1 + 5, 0, `${mainD.toFixed(1)} m`),
    label((mainX0 + mainX1) / 2, y0 - 12, `Max height ${heightM.toFixed(0)} m`, 'tag'),
  ];

  const parcelArea = p.parcelW * p.parcelD;
  const footprint = hallsW * mainD + adminW * (mainD - 12);
  const gfa = hallsW * mainD * p.storeys + adminW * (mainD - 12) * 3;
  const racks = Math.round((itAchieved * 1000) / rackKW);

  return {
    params: p,
    warnings,
    geojson: {
      masses: { type: 'FeatureCollection', features },
      lines: { type: 'FeatureCollection', features: lines },
      labels: { type: 'FeatureCollection', features: labels },
    },
    metrics: {
      itMW: itAchieved,
      itTargetMW: p.itMW,
      facilityMW: +facilityMW.toFixed(1),
      pue: +pue.toFixed(2),
      whiteSpaceM2: Math.round((itAchieved * 1000) / kWPerM2),
      racks,
      rackKW,
      gfaM2: Math.round(gfa),
      footprintM2: Math.round(footprint),
      parcelM2: parcelArea,
      plotRatio: +(gfa / parcelArea).toFixed(2),
      coveragePct: Math.round(((footprint + YARD_W * (p.parcelD - 2 * SETBACK)) / parcelArea) * 100),
      heightM: +heightM.toFixed(1),
      storeys: p.storeys,
      gensets,
      energyGWh: Math.round(energyGWh),
      waterM3: Math.round(waterM3),
      wue,
      carbonT: Math.round(carbonT),
      capexUSDm: Math.round(itAchieved * (liquid ? 12.5 : 10.5)),
    },
  };
}
