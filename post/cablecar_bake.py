"""Bake the Dajti Ekspres gondola for the viewer's cable-car layer (viewer/app/life/cablecar.json).

    <venv with osmium>/python -I post/cablecar_bake.py

The line is the OSM aerialway=gondola way 'Dajti Ekspres' (its nodes are the stations and the pylons). Heights: the DEM
(post/terrain.py, ellipsoidal) plus PYLON_M at each pylon and STATION_M at the two stations; between supports the cable
sags SAG of the span. Two cables, one per direction, LANE_M either side of the centre line.

cablecar.json (camera px; the viewer subtracts the canvas origin):
  length_m, speed_ms, spacing_m          ride geometry (cabins every spacing_m, both directions)
  up / down  {u: [...], v: [...], s: [...]}  cable polylines sampled every STEP_M; s = metres from the lower station
  pylons     [[u_top, v_top, u_foot, v_foot], ...]   for the short pylon strokes
  stations   [[u, v], [u, v]]            lower, upper (cable level)
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path[:0] = [HERE, os.path.join(ROOT, 'render')]
import project as P, terrain as Tn        # noqa: E402

PYLON_M, STATION_M, SAG, STEP_M, LANE_M = 22.0, 9.0, 0.025, 8.0, 3.0
SPEED_MS, SPACING_M = 4.8, 105.0          # ~15 min for the 4.35 km ride; a cabin about every 20 s


def gondola_nodes():
    import osmium
    ways = []

    class H(osmium.SimpleHandler):
        def way(self, w):
            if w.tags.get('aerialway') == 'gondola' and 'Dajti' in (w.tags.get('name') or ''):
                ways.append([(n.ref, n.location.lat, n.location.lon) for n in w.nodes if n.location.valid()])
    H().apply_file(os.path.join(ROOT, 'data', 'osm', 'albania-latest.osm.pbf'), locations=True)
    # chain the pieces into one line, lower station (west) first
    line = max(ways, key=len)
    for _ in range(len(ways)):
        for w in ways:
            if w is line: continue
            if w[-1][0] == line[0][0]: line = w[:-1] + line
            elif w[0][0] == line[-1][0]: line = line + w[1:]
    if line[0][2] > line[-1][2]: line = line[::-1]
    return [(la, lo) for _, la, lo in line]


def main():
    pts = gondola_nodes()
    lat0 = pts[0][0]; kx, ky = 111320 * math.cos(math.radians(lat0)), 110574
    xy = [((lo - pts[0][1]) * kx, (la - pts[0][0]) * ky) for la, lo in pts]
    # supports: drop OSM nodes closer than 25 m to the previous one (station platforms), keep the ends
    sup = [0]
    for i in range(1, len(pts)):
        if math.dist(xy[i], xy[sup[-1]]) > 25 or i == len(pts) - 1: sup.append(i)
    h = [Tn.elev(*pts[i]) + (STATION_M if k in (0, len(sup) - 1) else PYLON_M) for k, i in enumerate(sup)]
    cum = [0.0]
    for a, b in zip(sup, sup[1:]): cum.append(cum[-1] + math.dist(xy[a], xy[b]))
    L = cum[-1]

    def at(s, lane):
        k = max(0, min(len(sup) - 2, next((j for j in range(len(sup) - 1) if cum[j + 1] >= s), len(sup) - 2)))
        span = cum[k + 1] - cum[k]; f = (s - cum[k]) / span if span else 0
        a, b = sup[k], sup[k + 1]
        x = xy[a][0] + (xy[b][0] - xy[a][0]) * f; y = xy[a][1] + (xy[b][1] - xy[a][1]) * f
        dx, dy = (xy[b][0] - xy[a][0]) / span, (xy[b][1] - xy[a][1]) / span
        x += -dy * lane; y += dx * lane                                   # lane offset, left of the direction of travel
        hh = h[k] + (h[k + 1] - h[k]) * f - 4 * SAG * span * f * (1 - f)
        la, lo = pts[0][0] + y / ky, pts[0][1] + x / kx
        return P.to_px(la, lo, hh)

    n = int(L // STEP_M) + 1; ss = [min(L, i * STEP_M) for i in range(n)] + ([L] if n * STEP_M < L else [])
    out = {'length_m': round(L, 1), 'speed_ms': SPEED_MS, 'spacing_m': SPACING_M}
    for name, lane in (('up', -LANE_M), ('down', LANE_M)):
        uv = [at(s, lane) for s in ss]
        out[name] = {'u': [round(u, 1) for u, _ in uv], 'v': [round(v, 1) for _, v in uv], 's': [round(s, 1) for s in ss]}
    pyl = []
    for k, i in enumerate(sup[1:-1], 1):
        la, lo = pts[i]; g = Tn.elev(la, lo)
        (ut, vt), (uf, vf) = P.to_px(la, lo, g + PYLON_M), P.to_px(la, lo, g)
        pyl.append([round(ut, 1), round(vt, 1), round(uf, 1), round(vf, 1)])
    out['pylons'] = pyl
    out['stations'] = [[round(c, 1) for c in P.to_px(*pts[i], h[k])] for k, i in ((0, sup[0]), (len(sup) - 1, sup[-1]))]
    dst = os.path.join(ROOT, 'viewer', 'app', 'life', 'cablecar.json')
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(f'Dajti Ekspres: {L:.0f} m, {len(sup)} supports ({len(pyl)} pylons), rise {h[-1] - h[0]:.0f} m, '
          f'{len(ss)} samples per cable -> {dst} ({os.path.getsize(dst) // 1024} KB)')


if __name__ == '__main__':
    main()
