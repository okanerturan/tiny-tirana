"""Bake the Tirana bus timetable (GTFS) into one compact file for the viewer's Buses layer.

    python3 -I post/buses_bake.py data/gtfs/tirana-gtfs-2026-09-30.zip      # -> viewer/app/transit/buses.json

Geometry is baked in CAMERA px (u, v) of render/project.py, so it does not depend on the tile set's canvasOrigin; the
viewer subtracts the origin at runtime. Heights: post/occlusion.py line_heights (street level from the renderer's height
pass where the street is seen, straight interpolation behind towers); post/terrain.py's DEM includes buildings (~8 m
high), so DEM - 8 m is only the fallback outside the pass.
On two-way streets (another line runs the opposite way within 3.5 m) each direction keeps 1.3 m to the right so the
two directions do not drive through each other; one-way streets and split boulevards keep the GTFS line.
Where the line runs behind a roof or under a canopy (post/occlusion.py on the renderer's height pass, sampled every
4 m) it is stored as a hidden stretch, and the viewer fades the bus out there.

Output (all ints, deltas where it helps gzip):
  hidden   per shape: [start, length, start - previous end, length, ...] dm along the shape where buildings / trees hide it
  routes   [[short, long, '#rrggbb'], ...]
  stops    [name, ...]
  shapes   [[u0, v0, d0, du, dv, dd, ...]]           camera px and distance along the shape in decimetres
  pats     [[shape, route, headsign, [stop...], [dist_dm...]]]
  runs     [[pat, arr0, dwell0, arr1-dep0, dwell1, ...]]   seconds, relative to the first departure
  services [[id, weekday mask (Mon=bit0), start yyyymmdd, end yyyymmdd, [added...], [removed...]]]
  trips    per service: [run, start_s, run, start_s, ...]  sorted by start (start_s may exceed 86400)
"""
import csv, io, json, math, os, sys, zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path[:0] = [HERE, os.path.join(ROOT, 'render')]
from project import to_px, enu, CAM, GEO     # noqa: E402
from terrain import elev           # noqa: E402

RIGHT_OFFSET_M = 1.3               # keep right, on two-way streets only (see two_way)
TWO_WAY_M = 3.5                    # an opposite-direction line closer than this = the same (two-way) street
SIMPLIFY_PX = 1.5                  # max deviation (camera px, ~0.2 m) when thinning the resampled line
DENSIFY_M = 4.0                    # resample so the ground height follows the terrain and occlusion is tested every 4 m
DEM_BIAS_M = GEO['demBias']        # post/terrain.py reads ~7-9 m high in the city (it includes buildings)
OCC = None                         # post/occlusion.py, loaded in main() when the height pass exists
OUT = os.path.join(ROOT, 'viewer', 'app', 'transit', 'buses.json')


def read(z, name):
    return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig')))


def secs(s):
    h, m, x = (int(p) for p in s.strip().split(':')); return h * 3600 + m * 60 + x


LAT0, LON0 = CAM['lat'], CAM['lon']; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
to_xy = lambda lat, lon: ((lon - LON0) * KX, (lat - LAT0) * KY)                 # one local metric frame for every shape
from_xy = lambda x, y: (LAT0 + y / KY, LON0 + x / KX)


def resample(pts):
    """[(lat, lon, dist_m)] -> [(x, y, dist_m)] along the GTFS centreline, at most DENSIFY_M apart."""
    xy = [to_xy(la, lo) for la, lo, _ in pts]
    keep = [0] + [i for i in range(1, len(xy)) if math.dist(xy[i], xy[i - 1]) > 0.05]   # zero-length segments break normals
    xy = [xy[i] for i in keep]; ds = [pts[i][2] for i in keep]
    out = []
    for i in range(len(xy) - 1):
        steps = max(1, math.ceil(math.dist(xy[i], xy[i + 1]) / DENSIFY_M))
        for s in range(steps):
            f = s / steps
            out.append((xy[i][0] + (xy[i + 1][0] - xy[i][0]) * f, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * f, ds[i] + (ds[i + 1] - ds[i]) * f))
    out.append((xy[-1][0], xy[-1][1], ds[-1]))
    return out


def headings(p):
    h = []
    for i in range(len(p)):
        a, b = p[max(0, i - 1)], p[min(len(p) - 1, i + 1)]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
        h.append((dx / L, dy / L))
    return h


def two_way(samples):
    """Per sample, 0..1: is this a two-way street, i.e. does another bus line run here in the opposite direction?
    Only there is the keep-right offset applied; one-way streets and split boulevards keep the GTFS line as it is."""
    CELL = 5.0; grid = defaultdict(list); hs = {}
    for sid, p in samples.items():
        hs[sid] = headings(p)
        for (x, y, _), h in zip(p, hs[sid]): grid[(int(x // CELL), int(y // CELL))].append((sid, x, y, h))
    out = {}
    for sid, p in samples.items():
        flag = []
        for (x, y, _), h in zip(p, hs[sid]):
            cx, cy, hit = int(x // CELL), int(y // CELL), False
            for gx in (cx - 1, cx, cx + 1):
                for gy in (cy - 1, cy, cy + 1):
                    for osid, ox, oy, oh in grid.get((gx, gy), ()):
                        if osid != sid and (ox - x) ** 2 + (oy - y) ** 2 < TWO_WAY_M ** 2 and oh[0] * h[0] + oh[1] * h[1] < -0.7: hit = True; break
                    if hit: break
                if hit: break
            flag.append(1.0 if hit else 0.0)
        n, W = len(flag), 4                          # smooth over ~30 m so the offset eases in and out
        out[sid] = [sum(flag[max(0, i - W):i + W + 1]) / len(flag[max(0, i - W):i + W + 1]) for i in range(n)]
    return out


STATS = defaultdict(int)

# ---- snap buses onto the cars' lanes (so a bus and a car on the same road share one road model) ----
SQ = math.sqrt(0.5); MPP_M = CAM['mpp']
LANE_OFF, LANE_W, SNAP_M, SNAP_COS = 1.7, 3.2, 6.0, 0.85   # = cars.js; snap within 6 m, heading within ~30 deg
ROADS = None


def load_roads():
    """Car road segments in ground metres (u, v / sin45) with the lane offset a vehicle uses in each direction."""
    global ROADS
    f = os.path.join(ROOT, 'viewer', 'app', 'life', 'roads.json')
    if not os.path.exists(f): ROADS = []; return
    R = json.load(open(f)); V = R['verts']; segs = []
    for a, b, cls, flags, lanes, dl, *_ in R['edges']:
        pts = [(V[2 * a], V[2 * a + 1])]
        for i in range(0, len(dl), 2): pts.append((pts[-1][0] + dl[i], pts[-1][1] + dl[i + 1]))
        pts.append((V[2 * b], V[2 * b + 1]))
        oneway = flags & 1; per_dir = 2 if (oneway and cls <= 1 and lanes >= 2) else 1
        off = (0.0 if per_dir == 1 else 0.5 * LANE_W) if oneway else LANE_OFF          # rightmost lane, metres right of centre
        g = [(u * MPP_M, v / SQ * MPP_M) for u, v in pts]
        for p0, p1 in zip(g, g[1:]):
            if p0 != p1: segs.append((p0, p1, oneway, off))
    grid = defaultdict(list); C = 20.0
    for i, (p0, p1, _, _) in enumerate(segs):
        for gx in range(int(min(p0[0], p1[0]) // C) - 1, int(max(p0[0], p1[0]) // C) + 2):
            for gy in range(int(min(p0[1], p1[1]) // C) - 1, int(max(p0[1], p1[1]) // C) + 2): grid[(gx, gy)].append(i)
    ROADS = (segs, grid, C)


def snap_to_lanes(out):
    """out: [(u, v, dist_dm, vis)] -> same, with each sample moved onto the car lane it drives in (where it runs along a
    car road), blended in and out over ~30 m. Positions in camera px; the road network is already at street level."""
    if ROADS is None: load_roads()
    if not ROADS: return out
    segs, grid, C = ROADS
    g = [(u * MPP_M, v / SQ * MPP_M) for u, v, _, _ in out]; n = len(g)
    hd = []
    for i in range(n):
        a, b = g[max(0, i - 2)], g[min(n - 1, i + 2)]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1; hd.append((dx / L, dy / L))
    target, w = [None] * n, [0.0] * n
    for i, ((x, y), (hx, hy)) in enumerate(zip(g, hd)):
        best = None
        for j in grid.get((int(x // C), int(y // C)), ()):
            (x0, y0), (x1, y1), oneway, off = segs[j]
            sx, sy = x1 - x0, y1 - y0; L2 = sx * sx + sy * sy; t = max(0.0, min(1.0, ((x - x0) * sx + (y - y0) * sy) / L2))
            fx, fy = x0 + sx * t, y0 + sy * t; d = math.hypot(x - fx, y - fy)
            if d > SNAP_M: continue
            L = math.sqrt(L2); tx, ty = sx / L, sy / L; c = tx * hx + ty * hy
            if abs(c) < SNAP_COS or (oneway and c < 0): continue                       # wrong angle, or against a one-way
            if c < 0: tx, ty = -tx, -ty                                               # drive the segment in my direction
            # right-hand normal of (tx, ty) on this y-down ground plane is (-ty, tx), as cars.js offsets cars
            if best is None or d < best[0]: best = (d, fx - ty * off, fy + tx * off)
        if best: target[i] = (best[1], best[2]); w[i] = 1.0
    # smooth the weights over ~30 m (DENSIFY_M samples) so buses ease on and off the road model
    W = max(1, int(15 / DENSIFY_M)); ws = [sum(w[max(0, i - W):i + W + 1]) / len(w[max(0, i - W):i + W + 1]) for i in range(n)]
    res = []
    for i, (u, v, d, vis) in enumerate(out):
        if not target[i] or ws[i] <= 0: res.append((u, v, d, vis)); continue
        tx_, ty_ = target[i]; k = ws[i]
        gx, gy = g[i][0] + (tx_ - g[i][0]) * k, g[i][1] + (ty_ - g[i][1]) * k
        STATS['lane_snap'] += k > 0.5
        res.append((gx / MPP_M, gy * SQ / MPP_M, d, vis))
    return res


def light_smooth(hs, W=2):
    """A light +-W sample (~8 m each side) mean on the heights: line_heights already keeps them straight behind buildings."""
    n = len(hs); return [sum(hs[max(0, i - W):i + W + 1]) / len(hs[max(0, i - W):i + W + 1]) for i in range(n)]


def in_pass(u, v):
    return OCC._cell(u, v)[0] is not None                     # inside any loaded height grid


def shape_geometry(p, factor):
    """Resampled centreline + two-way factor -> ([(u, v, dist_dm)] simplified, hidden stretches).
    Heights: post/occlusion.py line_heights on every run of the line inside the height pass (street level where the street
    is seen, straight interpolation behind towers and trees); terrain.elev - 8 m outside it."""
    hs = headings(p); ll = []
    for (x, y, d), (hx, hy), f in zip(p, hs, factor):
        off = RIGHT_OFFSET_M * f; ll.append(from_xy(x + hy * off, y - hx * off))              # right-hand normal of (hx, hy)
    h = [elev(la, lo) + DEM_BIAS_M for la, lo in ll]
    if OCC:
        inside = [in_pass(*to_px(la, lo, hh)) for (la, lo), hh in zip(ll, h)]
        i = 0
        while i < len(ll):
            if not inside[i]: i += 1; continue
            j = i
            while j < len(ll) and inside[j]: j += 1
            for k, (_, _, hh) in enumerate(OCC.line_heights(ll[i:j])): h[i + k] = hh
            STATS['street'] += j - i; i = j
    h = light_smooth(h); out = []
    for (la, lo), hh, (_, _, d), f in zip(ll, h, p, factor):
        u, v = to_px(la, lo, hh)
        vis = OCC.visible_uv(u, v, enu(la, lo, hh)[2]) if OCC else True
        STATS['hidden'] += not vis; STATS['offset'] += f > 0.5; STATS['n'] += 1
        out.append((u, v, d * 10, vis))
    out = snap_to_lanes(out)                                   # buses in the cars' lanes where a car road carries them
    keep = simplify([o[:3] for o in out], SIMPLIFY_PX)
    return [(round(out[i][0]), round(out[i][1]), round(out[i][2])) for i in keep], hidden_intervals(out)


def hidden_intervals(out):
    """Stretches of the line hidden behind roofs / canopies: [(d0, d1)] in dm, after a 3-sample (~8 m) majority vote."""
    vis = [o[3] for o in out]; n = len(vis)
    sm = [vis[i] if i in (0, n - 1) else (vis[i - 1] + vis[i] + vis[i + 1]) >= 2 for i in range(n)]
    iv, start = [], None
    for i in range(n):
        if not sm[i] and start is None: start = (out[i - 1][2] + out[i][2]) / 2 if i else out[0][2]
        if sm[i] and start is not None: iv.append((round(start), round((out[i - 1][2] + out[i][2]) / 2))); start = None
    if start is not None: iv.append((round(start), round(out[-1][2])))
    merged = []                                       # close visible gaps < 15 m, then drop hidden specks < 8 m
    for a, b in iv:
        if merged and a - merged[-1][1] < 150: merged[-1] = (merged[-1][0], b)
        else: merged.append((a, b))
    return [(a, b) for a, b in merged if b - a >= 80]


def simplify(p, tol):
    """Douglas-Peucker on (u, v, d): drops the densified points where height (and distance) stay linear."""
    keep, stack = {0, len(p) - 1}, [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop(); best, bi = 0, -1
        ax, ay, ad = p[a]; bx, by, bd = p[b]; L = math.hypot(bx - ax, by - ay)
        for i in range(a + 1, b):
            x, y, d = p[i]
            # loop lines start and end at the same point: then the error is the plain distance from it
            e = abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L if L > 1 else math.hypot(x - ax, y - ay)
            f = (bd - ad) and (d - ad) / (bd - ad); g = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (L * L) if L > 1 else 0
            if L > 1: e = max(e, abs(f - g) * L)  # distance along must stay proportional to the drawn length
            if e > best: best, bi = e, i
        if best > tol: keep.add(bi); stack += [(a, bi), (bi, b)]
    return sorted(keep)


def main():
    global OCC
    occ_dir = os.path.join(ROOT, 'data', 'render', 'height_city')     # the whole city (never the airport render)
    if '--occ' in sys.argv: i = sys.argv.index('--occ'); occ_dir = sys.argv[i + 1]; del sys.argv[i:i + 2]
    if os.path.isdir(occ_dir) or os.path.exists(os.path.join(ROOT, 'data', f'occlusion_{os.path.basename(occ_dir)}.npz')):
        import occlusion as O; O.load(occ_dir); OCC = O
    else: print('no height pass at', occ_dir, '- every bus stays visible')
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'gtfs', 'tirana-gtfs-2026-09-30.zip')
    z = zipfile.ZipFile(src)
    feed = read(z, 'feed_info.txt')[0]
    routes = read(z, 'routes.txt'); trips = read(z, 'trips.txt'); stops = {s['stop_id']: s for s in read(z, 'stops.txt')}
    cal = read(z, 'calendar.txt'); cdates = read(z, 'calendar_dates.txt')
    agency_tz = read(z, 'agency.txt')[0]['agency_timezone']
    assert agency_tz == 'Europe/Tirane', agency_tz

    shp = defaultdict(list)
    for r in read(z, 'shapes.txt'):
        shp[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']), float(r['shape_dist_traveled'] or 'nan')))
    st = defaultdict(list)
    for r in read(z, 'stop_times.txt'):
        st[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], secs(r['arrival_time']), secs(r['departure_time']), float(r['shape_dist_traveled'])))

    route_ix = {}; out_routes = []
    for r in sorted(routes, key=lambda r: (int(''.join(c for c in r['route_short_name'] if c.isdigit()) or 0), r['route_short_name'])):
        route_ix[r['route_id']] = len(out_routes)
        out_routes.append([r['route_short_name'], r['route_long_name'].replace(' - ', ' – '), '#' + r['route_color'].lower()])

    used = sorted({t['shape_id'] for t in trips if len(st.get(t['trip_id'], [])) >= 2})
    samples = {}
    for sid in used:
        pts = [(la, lo, d) for _, la, lo, d in sorted(shp[sid])]
        assert all(not math.isnan(p[2]) for p in pts), sid
        samples[sid] = resample(pts)
    factors = two_way(samples)
    shape_ix, out_shapes, out_hidden = {}, [], []
    for sid in used:
        g, hid = shape_geometry(samples[sid], factors[sid]); flat = list(g[0])
        for a, b in zip(g, g[1:]): flat += [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        hflat, prev = [], 0
        for a, b in hid: hflat += [a - prev, b - a]; prev = b
        shape_ix[sid] = len(out_shapes); out_shapes.append(flat); out_hidden.append(hflat)
    shape_of = shape_ix.__getitem__

    stop_ix, out_stops = {}, []
    def stop_of(sid):
        if sid not in stop_ix: stop_ix[sid] = len(out_stops); out_stops.append(stops[sid]['stop_name'].strip())
        return stop_ix[sid]

    svc_ix, out_svc = {}, []
    added, removed = defaultdict(list), defaultdict(list)
    for d in cdates: (added if d['exception_type'] == '1' else removed)[d['service_id']].append(int(d['date']))
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    calmap = {c['service_id']: c for c in cal}
    for sid in sorted({t['service_id'] for t in trips}):
        c = calmap.get(sid)
        mask = sum(1 << i for i, d in enumerate(days) if c and c[d] == '1')
        svc_ix[sid] = len(out_svc)
        out_svc.append([sid, mask, int(c['start_date']) if c else 0, int(c['end_date']) if c else 0, sorted(added[sid]), sorted(removed[sid])])

    pat_ix, out_pats, run_ix, out_runs = {}, [], {}, []
    by_svc = defaultdict(list); skipped = 0
    for t in trips:
        rows = sorted(st.get(t['trip_id'], []))
        if len(rows) < 2: skipped += 1; continue
        si = shape_of(t['shape_id'])
        pkey = (si, route_ix[t['route_id']], t['trip_headsign'].strip(), tuple(stop_of(r[1]) for r in rows), tuple(round(r[4] * 10) for r in rows))
        if pkey not in pat_ix: pat_ix[pkey] = len(out_pats); out_pats.append([pkey[0], pkey[1], pkey[2], list(pkey[3]), list(pkey[4])])
        t0 = rows[0][3]; run = [pat_ix[pkey]]; prev = t0
        for i, (_, _, arr, dep, _) in enumerate(rows):
            if i == 0: arr = dep          # the first stop's arrival is irrelevant: the trip starts at its departure
            run += [arr - prev, dep - arr]; prev = dep
        run = tuple(run)
        if run not in run_ix: run_ix[run] = len(out_runs); out_runs.append(list(run))
        by_svc[svc_ix[t['service_id']]].append((t0, run_ix[run]))
    out_trips = []
    for i in range(len(out_svc)):
        flat = []
        for t0, ri in sorted(by_svc[i]): flat += [ri, t0]
        out_trips.append(flat)

    data = dict(v=2, tz=agency_tz, feed=dict(version=feed['feed_version'], start=feed['feed_start_date'], end=feed['feed_end_date'],
                license=feed['license'], attribution=feed['license_attribution_text']),
                routes=out_routes, stops=out_stops, shapes=out_shapes, hidden=out_hidden, pats=out_pats, runs=out_runs, services=out_svc, trips=out_trips)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    open(OUT, 'w', encoding='utf-8').write(txt)
    import gzip
    n = STATS['n']
    print(f"samples {n}: inside the height pass (line_heights) {STATS['street'] / n:.0%}, DEM - 8 m outside {1 - STATS['street'] / n:.0%}, "
          f"keep-right offset {STATS['offset'] / n:.0%}, in a car lane {STATS['lane_snap'] / n:.0%}, hidden {STATS['hidden'] / n:.1%} ({sum(len(h) // 2 for h in out_hidden)} stretches)")
    print(f'{OUT}: {len(txt) / 1024:.0f} KB raw, {len(gzip.compress(txt.encode(), 9)) / 1024:.0f} KB gzip | feed {feed["feed_version"]} | '
          f'{len(out_routes)} routes, {len(out_shapes)} shapes, {sum(len(s) for s in out_shapes) // 3} pts, {len(out_pats)} patterns, '
          f'{len(out_runs)} runs, {sum(len(x) for x in out_trips) // 2} trips ({skipped} skipped), {len(out_stops)} stops')


if __name__ == '__main__':
    main()
