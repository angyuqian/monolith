#!/usr/bin/env python3
"""Preprocess the raw OSM building export into small files the browser can load.

Usage:  python3 scripts/prep_data.py
Input:  data/sg_buildings_v5.geojson   (~135MB, 118k buildings)
Output: data/build/
          buildings.core.json    non-landed buildings, compact encoding (see encode_compact)
          buildings.landed.json  landed houses, same encoding (lazy-loaded)
          datacentres.geojson    existing data centres (points)
          substations.geojson    named substations (points)
          suitability.geojson    ~250m score grid (polygons, only promising cells)
          sites.json             top candidate sites with score breakdown
Stdlib only — no pip installs needed.
"""
import json
import math
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "sg_buildings_v5.geojson")
OUT = os.path.join(ROOT, "data", "build")

LAT0 = 1.35
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))
CELL_M = 250.0

DEFAULT_HEIGHT = {
    "landed_property": 8, "hdb": 36, "private_apartment": 45, "shophouse": 10,
    "industrial": 14, "office": 40, "retail": 16, "hotel": 40, "data_centre": 24,
    "business_park": 24, "mixed_development": 45, "hospital": 30, "ihl": 18,
    "non_ihl": 14, "community_cultural": 10, "sports": 10,
}
INDUSTRIAL = {"industrial", "business_park", "data_centre"}
RESIDENTIAL = {"hdb", "private_apartment", "landed_property", "nursing_home"}


def clean(v):
    return None if v in (None, "None", "") else v


def height_of(p):
    h = p.get("height") or 0
    if h and h > 0:
        return round(float(h), 1)
    try:
        lv = int(float(p.get("building_levels") or 0))
    except ValueError:
        lv = 0
    if lv > 0:
        return round(lv * 3.2, 1)
    return DEFAULT_HEIGHT.get(p.get("building_archetype"), 10)


SIMPLIFY_DEG = 0.000006  # ~0.7m Douglas-Peucker tolerance


def simplify(pts, tol):
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / norm
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 4 else pts


def round_ring(ring):
    out = []
    for x, y in simplify(ring, SIMPLIFY_DEG):
        pt = [round(x, 5), round(y, 5)]
        if not out or out[-1] != pt:
            out.append(pt)
    return out if len(out) >= 4 else None


def slim_geom(g):
    if g["type"] == "Polygon":
        rings = [r for r in (round_ring(r) for r in g["coordinates"]) if r]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if g["type"] == "MultiPolygon":
        polys = []
        for poly in g["coordinates"]:
            rings = [r for r in (round_ring(r) for r in poly) if r]
            if rings:
                polys.append(rings)
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    return None


def outer_ring(g):
    return g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]


def centroid(g):
    ring = outer_ring(g)
    n = len(ring) - 1 or 1
    return (sum(p[0] for p in ring[:n]) / n, sum(p[1] for p in ring[:n]) / n)


def dist_m(a, b):
    dx = (a[0] - b[0]) * M_PER_DEG_LON
    dy = (a[1] - b[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


def point(lon, lat, props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}, "properties": props}


ARCH_INDEX = {}


def encode_compact(features):
    """Compact building format decoded by js/map/layers/buildings.js.

    {origin:[lon,lat], scale:1e5, arch:[...], f:[[h, archIdx, name|0, polys]]}
    polys = [[ring, ...], ...]; ring = flat int deltas [dx0,dy0,dx1,dy1,...] in 1e-5 deg,
    first pair relative to origin. Closing point is dropped (decoder re-closes).
    """
    ox, oy = 103.6, 1.2
    arch, out = [], []
    for ft in features:
        p, g = ft["properties"], ft["geometry"]
        a = p["a"]
        if a not in ARCH_INDEX:
            ARCH_INDEX[a] = len(ARCH_INDEX)
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        enc_polys = []
        for poly in polys:
            enc_rings = []
            for ring in poly:
                px, py = ox, oy
                flat = []
                for x, y in ring[:-1]:
                    ix, iy = round((x - px) * 1e5), round((y - py) * 1e5)
                    flat += [ix, iy]
                    px, py = px + ix / 1e5, py + iy / 1e5
                enc_rings.append(flat)
            enc_polys.append(enc_rings)
        h = p["h"]
        out.append([int(h) if h == int(h) else h, ARCH_INDEX[a], p.get("n", 0), enc_polys])
    return {"origin": [ox, oy], "scale": 1e5, "arch": sorted(ARCH_INDEX, key=ARCH_INDEX.get), "f": out}


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  {name:24s} {os.path.getsize(path) / 1e6:6.2f} MB")


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Loading", SRC)
    with open(SRC) as f:
        feats = json.load(f)["features"]
    print(f"  {len(feats)} features")

    core, landed, dcs, subs, streets = [], [], [], [], []
    cells = defaultdict(lambda: {"ind": 0.0, "res": 0.0, "all": 0.0, "n": 0, "names": []})
    minx = min(outer_ring(ft["geometry"])[0][0] for ft in feats)
    miny = min(outer_ring(ft["geometry"])[0][1] for ft in feats)
    cell_dlon = CELL_M / M_PER_DEG_LON
    cell_dlat = CELL_M / M_PER_DEG_LAT

    for ft in feats:
        p = ft["properties"]
        g = slim_geom(ft["geometry"])
        if not g:
            continue
        a = p.get("building_archetype") or "other"
        name = clean(p.get("addr_housename"))
        street = clean(p.get("addr_street"))
        props = {"h": height_of(p), "a": a}
        if name:
            props["n"] = name
        feat = {"type": "Feature", "geometry": g, "properties": props}
        (landed if a == "landed_property" else core).append(feat)

        c = centroid(g)
        lname = (name or "").lower()
        if a == "data_centre" or "data cent" in lname or "data centre" in lname or lname.endswith(" dc") or " gdc" in lname:
            if "college" not in lname and "substation" not in lname and "link" not in lname:
                dcs.append(point(*c, {"name": name or "Data centre", "h": props["h"]}))
        if "substation" in lname and not lname.startswith("the "):
            subs.append(point(*c, {"name": name}))
        if street:
            streets.append((c, street.title() if street.isupper() else street))

        fp = p.get("building_footprint") or 0
        key = (int((c[0] - minx) / cell_dlon), int((c[1] - miny) / cell_dlat))
        cell = cells[key]
        cell["all"] += fp
        cell["n"] += 1
        if a in INDUSTRIAL:
            cell["ind"] += fp
        if a in RESIDENTIAL:
            cell["res"] += fp

    print(f"  core={len(core)} landed={len(landed)} dcs={len(dcs)} substations={len(subs)}")

    # ---- suitability grid ------------------------------------------------
    sub_pts = [s["geometry"]["coordinates"] for s in subs]
    dc_pts = [d["geometry"]["coordinates"] for d in dcs]
    grid = []
    for (i, j), c in cells.items():
        if c["ind"] <= 0:
            continue
        cx = minx + (i + 0.5) * cell_dlon
        cy = miny + (j + 0.5) * cell_dlat
        # residential exposure in 3x3 neighbourhood (buffer to housing)
        nb_res = sum(cells[(i + di, j + dj)]["res"] for di in (-1, 0, 1) for dj in (-1, 0, 1) if (i + di, j + dj) in cells)
        nb_all = sum(cells[(i + di, j + dj)]["all"] for di in (-1, 0, 1) for dj in (-1, 0, 1) if (i + di, j + dj) in cells) or 1
        ind_share = min(1.0, c["ind"] / max(c["all"], 1))
        res_share = min(1.0, nb_res / nb_all)
        d_sub = min((dist_m((cx, cy), s) for s in sub_pts), default=9e9)
        d_dc = min((dist_m((cx, cy), d) for d in dc_pts), default=9e9)
        s_land = ind_share
        s_power = max(0.0, 1 - d_sub / 3000)
        s_fibre = max(0.0, 1 - d_dc / 5000)
        s_comm = 1 - res_share
        score = 100 * (0.35 * s_land + 0.25 * s_power + 0.20 * s_fibre + 0.20 * s_comm)
        if score < 40:
            continue
        x0, y0 = minx + i * cell_dlon, miny + j * cell_dlat
        pad_x, pad_y = cell_dlon * 0.06, cell_dlat * 0.06
        ring = [[x0 + pad_x, y0 + pad_y], [x0 + cell_dlon - pad_x, y0 + pad_y],
                [x0 + cell_dlon - pad_x, y0 + cell_dlat - pad_y], [x0 + pad_x, y0 + cell_dlat - pad_y]]
        ring = [[round(x, 6), round(y, 6)] for x, y in ring]
        ring.append(ring[0])
        grid.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "id": f"c{i}_{j}", "score": round(score, 1),
                "land": round(s_land * 100), "power": round(s_power * 100),
                "fibre": round(s_fibre * 100), "community": round(s_comm * 100),
                "dSub": round(d_sub), "dDc": round(d_dc),
                "cx": round(cx, 6), "cy": round(cy, 6),
            },
        })
    print(f"  suitability cells={len(grid)}")

    # ---- top sites (non-max suppression, 1.5km apart) --------------------
    ranked = sorted(grid, key=lambda f: -f["properties"]["score"])
    sites = []
    for f in ranked:
        p = f["properties"]
        c = (p["cx"], p["cy"])
        if any(dist_m(c, (s["lng"], s["lat"])) < 1500 for s in sites):
            continue
        near = min(streets, key=lambda n: dist_m(c, n[0]))
        near_sub = min(subs, key=lambda s: dist_m(c, s["geometry"]["coordinates"]))
        near_dc = min(dcs, key=lambda d: dist_m(c, d["geometry"]["coordinates"]))
        sites.append({
            "id": f"site-{len(sites) + 1}", "cellId": p["id"],
            "name": f"Site {chr(65 + len(sites))} · {near[1]}",
            "lng": p["cx"], "lat": p["cy"], "score": p["score"],
            "breakdown": {k: p[k] for k in ("land", "power", "fibre", "community")},
            "nearestSubstation": {"name": near_sub["properties"]["name"], "distanceM": p["dSub"]},
            "nearestDataCentre": {"name": near_dc["properties"]["name"], "distanceM": p["dDc"]},
        })
        if len(sites) == 8:
            break

    print("Writing", OUT)
    write("buildings.core.json", encode_compact(core))
    write("buildings.landed.json", encode_compact(landed))
    write("datacentres.geojson", {"type": "FeatureCollection", "features": dcs})
    write("substations.geojson", {"type": "FeatureCollection", "features": subs})
    write("suitability.geojson", {"type": "FeatureCollection", "features": grid})
    write("sites.json", sites)
    for s in sites:
        print(f"  {s['score']:5.1f}  {s['name']}  ({s['lat']:.4f},{s['lng']:.4f})")


if __name__ == "__main__":
    main()
