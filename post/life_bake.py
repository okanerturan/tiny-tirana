"""Bake the lake-birds layer (bird-safe water fields + lakeside grass), in CAMERA px (subtract the canvas origin at runtime).

    uv run -q --python 3.12 --with osmium --with numpy --with scipy --with pillow python -I post/life_bake.py [--roads]

--roads also bakes the main-road graph for the sparse toy cars into viewer/app/life/roads.json.

Needs the height-pass cache (post/occlusion.py): street level for every road point (the DEM is a surface model and puts
streets metres too high) and the depth test that hides cars behind buildings and under trees.

Output: viewer/app/life/water.json (+ viewer/app/life/roads.json with --roads)

roads.json
  ext   [u0, v0, u1, v1]  camera px of the painted extent the graph was clipped to
  verts flat [u, v, ...] (int px, true street height included) of junctions / ends
  edges [a, b, cls, flags, lanes, dl, hf, hb]   a/b vertex ids, dl = interior points as deltas from the previous point (int px)
        hf / hb = stretches where the a->b / b->a lane is hidden from the camera (building or tree in front): [s0, s1, ...]
        forward metres x10
        cls 0 primary/trunk 1 secondary 2 tertiary 3 residential/unclassified/living 4 service
        flags 1 oneway a->b, 2 hidden (tunnel/covered), 16 roundabout ring, 4 / 8 a / b is a portal (painting edge, or where a main road meets
        streets we leave out): cars fade out and new ones fade in there
water.json
  {fields: [{name, u0, g0, cell, w, h, d}], shore: [{u: [...], v: [...]}]}
    fields: distance-to-shore on the GROUND plane of each water surface; column i, row j is camera px u = u0 + i*cell,
        v = (g0 + j*cell) * SQ (SQ = sin 45). d = base64 bytes, metres to the nearest shore OR hidden water (0 = land), cap 60.
    shore: patches of open, visible grass/path by the lake (camera px) where Muscovy ducks waddle.
"""
import base64, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, os.path.join(ROOT, 'render')); sys.path.insert(0, HERE)
import project as P
import terrain, water
import occlusion as O

MPP, SQ = P.CAM['mpp'], math.sqrt(0.5)
PXM = 1 / MPP
HEIGHT = os.path.join(ROOT, 'data', 'render', 'height_city')   # the whole painted city (75 km2); no airport grid
INSET = 48                                                    # keep cars a little inside the painted edge
EXT = None                                                    # camera px box of the height pass, set by setup()


def setup():
    """Load the city height pass; the painted extent is where it has data."""
    global EXT
    O.load(HEIGHT)
    G = O._grids[0]; h, w = G['g'].shape
    EXT = (G['u0'] + INSET, G['v0'] + INSET, G['u0'] + w * G['s'] - INSET, G['v0'] + h * G['s'] - INSET)
    print('extent (camera px)', EXT)
OUT = os.path.join(ROOT, 'viewer', 'app', 'life')

CLS = {'trunk': 0, 'trunk_link': 0, 'primary': 0, 'primary_link': 0, 'secondary': 1, 'secondary_link': 1,
       'tertiary': 2, 'tertiary_link': 2, 'residential': 3, 'unclassified': 3, 'living_street': 3, 'service': 4}
LANES = {0: 4, 1: 2, 2: 2, 3: 2, 4: 2}
LANE_OFF = 1.7                                                 # metres right of the centre line on two-way roads (runtime uses the same)
CAR_FREE = {'Sheshi Nënë Tereza'}                              # pedestrian squares OSM still maps with a roundabout
MIN_SPUR, MIN_COMP = 60.0, 1000.0
MAX_CLS = 2                                                    # main roads only: trunk/primary/secondary/tertiary (+ links)                              # metres: drop dead-end spurs shorter than this, components shorter than that
SERVICE_OK = {None, 'alley'}                                  # "service-lite": no parking aisles / driveways
NO = {'no', 'private', 'customers', 'delivery', 'destination_only'}


def inside(u, v):
    if not (EXT[0] <= u <= EXT[2] and EXT[1] <= v <= EXT[3]): return False
    z = O.surface_z(u, v); return z is not None and z > -500      # inside the rendered (painted) city, not a hole


def read_ways():
    import osmium
    lat0, lat1, lon0, lon1 = 41.20, 41.47, 19.62, 20.00       # generous box around the painted city
    ways = []

    class H(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags; hw = t.get('highway')
            if hw not in CLS or CLS[hw] > MAX_CLS or t.get('area') == 'yes': return
            if hw == 'service' and t.get('service') not in SERVICE_OK: return
            if t.get('access') in NO or t.get('motor_vehicle') in NO or t.get('motorcar') in NO or t.get('vehicle') in NO: return
            jn = t.get('junction')
            if t.get('name') in CAR_FREE: return
            if w.is_closed() and jn not in ('roundabout', 'circular'): return     # rings round squares / car parks: cars would circle
            try: pts = [(n.ref, n.lat, n.lon) for n in w.nodes]
            except osmium.InvalidLocationError: return
            if not any(lat0 < la < lat1 and lon0 < lo < lon1 for _, la, lo in pts): return
            ow = t.get('oneway')
            oneway = 1 if ow in ('yes', '1', 'true') or (jn in ('roundabout', 'circular') and ow != 'no') else (-1 if ow == '-1' else 0)
            try: lanes = int(t.get('lanes', '').split(';')[0])
            except ValueError: lanes = 0
            try: layer = int(t.get('layer', '0').split(';')[0] or 0)
            except ValueError: layer = 0
            ways.append(dict(id=w.id, cls=CLS[hw], oneway=oneway, lanes=lanes, ring=jn in ('roundabout', 'circular'), bridge=t.get('bridge') not in (None, 'no'), layer=layer,
                             hidden=t.get('tunnel') not in (None, 'no') or t.get('covered') == 'yes' or int(t.get('layer', '0').split(';')[0] or 0) < 0 and t.get('bridge') in (None, 'no'),
                             nodes=pts))
    H().apply_file(os.path.join(ROOT, 'data', 'osm', 'albania-latest.osm.pbf'), locations=True, idx='flex_mem')
    # service roads only where they link two real roads, trimmed to the stretch between the links
    main = set(r for w in ways if w['cls'] != 4 for r, _, _ in w['nodes'])
    out = []
    for w in ways:
        if w['cls'] == 4:
            idx = [i for i, (r, _, _) in enumerate(w['nodes']) if r in main]
            if len(idx) < 2 or idx[0] == idx[-1]: continue
            w = dict(w, nodes=w['nodes'][idx[0]:idx[-1] + 1])
        out.append(w)
    return out


def rdp(pts, eps):
    """Douglas-Peucker on (u, v, ...) tuples, distance in camera px."""
    if len(pts) < 3: return pts
    ax, ay, bx, by = pts[0][0], pts[0][1], pts[-1][0], pts[-1][1]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i][0] - ax, pts[i][1] - ay
        dist = abs(dx * py - dy * px) / L if L > 0 else math.hypot(px, py)
        if dist > best: best, bi = dist, i
    if best <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:bi + 1], eps)[:-1] + rdp(pts[bi:], eps)


def street(la, lo, h=None):
    """(u, v, z_enu) of a street point at its true level (height pass), DEM only outside it."""
    if h is None:
        rp = O.road_point(la, lo)
        h = rp[2] if rp else terrain.elev(la, lo)
        if rp:      # the 35 m local minimum can drop into a river channel or underpass beside the street: look closer (+-8 m),
                    # and where the low end of that is only a little higher (not tree canopy), sit on it instead
            g, gu0, gv0 = O._g
            for _ in range(3):
                u, v = P.to_px(la, lo, h); z = P.enu(la, lo, h)[2]
                r, c = int((v - gv0) // O.SCALE), int((u - gu0) // O.SCALE)
                win = g[max(0, r - 20):r + 21, max(0, c - 27):c + 28].astype(np.float32)
                win = win[win > -500]
                if not win.size: break
                lo10 = float(np.percentile(win, 10))
                if not (0.3 < lo10 - z < 4.0): break
                h += lo10 - z
    u, v = P.to_px(la, lo, h)
    return u, v, P.enu(la, lo, h)[2], h


def hidden_runs(pts, side, step=1.0):
    """Stretches (forward metres x10) of a lane `side` metres right of the centre line that the camera can't see."""
    flags, s_at, s = [], [], 0.0
    for (u0, v0, z0), (u1, v1, z1) in zip(pts, pts[1:]):
        gx, gy = u1 - u0, (v1 - v0) / SQ; gl = math.hypot(gx, gy); L = gl * MPP
        if L == 0: continue
        nx, ny = -gy / gl, gx / gl                                  # right-hand normal (ground px, v down)
        n = max(1, int(L / step))
        for k in range(n):
            t = k / n
            u = u0 + (u1 - u0) * t + nx * side * PXM; v = v0 + (v1 - v0) * t + ny * side * PXM * SQ
            flags.append(not O.visible_uv(u, v, z0 + (z1 - z0) * t)); s_at.append(s + L * t)
        s += L
    if not flags: return []
    flags.append(flags[-1]); s_at.append(s)
    # close visible gaps < 3 m inside hidden stretches, then drop hidden stretches < 2 m (no flicker)
    runs, i = [], 0
    while i < len(flags):
        if flags[i]:
            j = i
            while j + 1 < len(flags) and flags[j + 1]: j += 1
            runs.append([s_at[i], s_at[j]]); i = j + 1
        else: i += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 3.0: merged[-1][1] = r[1]
        else: merged.append(r)
    return [round(x * 10) for a, b in merged if b - a >= 2.0 for x in (a, b)]


def bake_roads():
    ways = read_ways()
    # street level per OSM way, densified to <= 4 m: O.line_heights trusts road_point only where the street is visible and
    # interpolates behind tall buildings (no kinks over towers). Bridges: straight between their ends (the height pass sees
    # the river). A node shared by several ways gets the mean of their estimates, so edges still meet.
    dense, acc = [], {}
    for w in ways:
        ns = w['nodes']; ll, refs = [], []
        for i, (ref, la, lo) in enumerate(ns):
            if i:
                _, a0, b0 = ns[i - 1]; dist = math.hypot((la - a0) * 111320, (lo - b0) * 83600); n = int(dist // 4)
                for k in range(1, n + 1): t = k / (n + 1); ll.append((a0 + (la - a0) * t, b0 + (lo - b0) * t)); refs.append(None)
            ll.append((la, lo)); refs.append(ref)
        res = O.line_heights(ll, elevated=w['bridge'] or w.get('layer', 0) > 0)
        if w['bridge'] and len(res) > 1:
            cum = [0.0]
            for (a0, b0), (a1, b1) in zip(ll, ll[1:]): cum.append(cum[-1] + math.hypot((a1 - a0) * 111320, (b1 - b0) * 83600))
            h0, h1 = res[0][2], res[-1][2]
            res = [(*P.to_px(la, lo, h0 + (h1 - h0) * c / (cum[-1] or 1)), 0) for (la, lo), c in zip(ll, cum)]
            res = [(u, v, h0 + (h1 - h0) * c / (cum[-1] or 1)) for (u, v, _), c in zip(res, cum)]
        items = []
        for (la, lo), ref, (u, v, h) in zip(ll, refs, res):
            z = P.enu(la, lo, h)[2]; items.append([ref, u, v, z])
            if ref is not None: q = acc.setdefault(ref, [0, 0, 0, 0]); q[0] += u; q[1] += v; q[2] += z; q[3] += 1
        dense.append((w, items))
    px = {r: (q[0] / q[3], q[1] / q[3], q[2] / q[3]) for r, q in acc.items()}
    for w, items in dense:
        for it in items:
            if it[0] is not None: it[1], it[2], it[3] = px[it[0]]
    ins = lambda r: inside(px[r][0], px[r][1])
    # split ways into runs of points inside the extent
    runs = []
    for w, items in dense:
        cur = []
        for it in items:
            if inside(it[1], it[2]): cur.append(it)
            else:
                if sum(1 for x in cur if x[0] is not None) > 1: runs.append((w, cur))
                cur = []
        if sum(1 for x in cur if x[0] is not None) > 1: runs.append((w, cur))
    for i, (w, cur) in enumerate(runs):                            # runs start and end on a real node
        while cur and cur[0][0] is None: cur.pop(0)
        while cur and cur[-1][0] is None: cur.pop()
    use = {}
    for w, cur in runs:
        nodes = [x[0] for x in cur if x[0] is not None]
        for i, r in enumerate(nodes): use[r] = use.get(r, 0) + (1 if 0 < i < len(nodes) - 1 else 2)
    cut = set()                                                 # vertices where a road leaves the painting
    for w in ways:
        ns = [r for r, _, _ in w['nodes']]
        for i, r in enumerate(ns):
            if ins(r) and ((i > 0 and not ins(ns[i - 1])) or (i < len(ns) - 1 and not ins(ns[i + 1]))): cut.add(r)
    edges = []                                                  # [ra, rb, cls, oneway, hidden, lanes, pts, length m]
    for w, cur in runs:
        start = 0
        for i in range(1, len(cur)):
            r = cur[i][0]
            if r is not None and (use[r] >= 2 or i == len(cur) - 1):
                seg = cur[start:i + 1]
                if len(seg) >= 2 and seg[0][0] != seg[-1][0]:
                    pts = rdp([(x[1], x[2], x[3]) for x in seg], 1.2)
                    ra, rb = seg[0][0], seg[-1][0]
                    if w['oneway'] == -1: ra, rb, pts = rb, ra, pts[::-1]
                    L = sum(math.hypot(p[0] - q[0], (p[1] - q[1]) / SQ) for p, q in zip(pts, pts[1:])) * MPP
                    edges.append([ra, rb, w['cls'], w['oneway'] != 0, (w['hidden'], w['ring']), w['lanes'] or LANES[w['cls']], pts, L])
                start = i
    # prune short dead-end spurs (repeatedly). Main roads end where they meet the side streets we leave out: those ends,
    # and one-ways that lead nowhere / come from nowhere, become PORTALS (like the painting's edge): cars fade out there and
    # new ones fade in, as if they turned off into a side street.
    while True:
        deg = {}
        for e in edges:
            for r in (e[0], e[1]): deg[r] = deg.get(r, 0) + 1
        keep = [e for e in edges if not (e[7] < MIN_SPUR and ((deg[e[0]] == 1 and e[0] not in cut) or (deg[e[1]] == 1 and e[1] not in cut)))]
        if len(keep) == len(edges): break
        edges = keep
    parent = {}
    def find(x):
        while parent.setdefault(x, x) != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for e in edges: parent[find(e[0])] = find(e[1])
    comp = {}
    for e in edges: comp[find(e[0])] = comp.get(find(e[0]), 0) + e[7]
    big = max(comp.values())
    edges = [e for e in edges if comp[find(e[0])] >= MIN_COMP or comp[find(e[0])] == big]
    print(f'components kept: {sum(1 for c in comp.values() if c >= MIN_COMP or c == big)} of {len(comp)}')
    deg, outd, ind = {}, {}, {}
    for e in edges:
        for r in (e[0], e[1]): deg[r] = deg.get(r, 0) + 1
        outd[e[0]] = outd.get(e[0], 0) + 1; ind[e[1]] = ind.get(e[1], 0) + 1
        if not e[3]: outd[e[1]] = outd.get(e[1], 0) + 1; ind[e[0]] = ind.get(e[0], 0) + 1
    portals = {r for r in deg if deg[r] == 1 or not outd.get(r) or not ind.get(r)}
    print(f'portals: {len(portals - cut)} (+ {len(cut & set(deg))} on the painting edge)')
    cut |= portals
    vid, verts = {}, []
    def vert(r):
        if r not in vid: vid[r] = len(verts); verts.append(r)
        return vid[r]
    vxy = []
    out_edges, total, hid, lane_m = [], [0.0] * 5, 0, 0
    for ra, rb, cls, oneway, (hidden, ring), lanes, pts, L in edges:
        a, b = vert(ra), vert(rb)
        while len(vxy) < 2 * len(verts): r = verts[len(vxy) // 2]; vxy += [round(px[r][0]), round(px[r][1])]
        prev = (vxy[2 * a], vxy[2 * a + 1]); dl = []
        for u, v, _ in pts[1:-1]:
            q = (round(u), round(v)); dl += [q[0] - prev[0], q[1] - prev[1]]; prev = q
        flags = (1 if oneway else 0) | (2 if hidden else 0) | (4 if ra in cut else 0) | (8 if rb in cut else 0) | (16 if ring else 0)
        hf = hidden_runs(pts, 0.0 if oneway else LANE_OFF)
        hb = [] if oneway else hidden_runs(pts, -LANE_OFF)
        out_edges.append([a, b, cls, flags, lanes, dl, hf, hb])
        hid += sum(hf[1::2]) - sum(hf[0::2]) + sum(hb[1::2]) - sum(hb[0::2]); lane_m += L * (1 if oneway else 2)
        total[cls] += L
    data = dict(v=2, mpp=MPP, ext=list(EXT), verts=vxy, edges=out_edges)
    json.dump(data, open(os.path.join(OUT, 'roads.json'), 'w'), separators=(',', ':'))
    print(f'roads: {len(verts)} verts, {len(out_edges)} edges, km by class', [round(x / 1000, 1) for x in total],
          f'{os.path.getsize(os.path.join(OUT, "roads.json")) / 1024:.0f} KB, hidden {hid / 10 / lane_m:.0%} of {lane_m / 1000:.0f} lane-km')


def water_polys():
    """Lakes and ponds projected at the water level the height pass actually sees (not a fixed guess)."""
    raw = json.load(open(os.path.join(ROOT, 'data', 'osm', 'water.json')))
    g, gu0, gv0 = O._g
    for i, o in enumerate(raw):
        if o['kind'] not in water.KINDS or len(o['outer']) < 4: continue
        la = sum(a for a, _ in o['outer']) / len(o['outer']); lo = sum(b for _, b in o['outer']) / len(o['outer'])
        h = P.CAM['groundH'] - 2
        for _ in range(3):
            pts = np.array([P.to_px(a, b, h) for a, b in o['outer']])
            c = pts.mean(0); r = (pts.max(0) - pts.min(0)) / 6          # sample the middle third
            zs = [O.surface_z(c[0] + x * r[0], c[1] + y * r[1]) for x in np.linspace(-1, 1, 7) for y in np.linspace(-1, 1, 7)]
            zs = [z for z in zs if z is not None and z > -500]
            if not zs: break
            dz = float(np.percentile(zs, 30)) - P.enu(la, lo, h)[2]
            h += dz
            if abs(dz) < 0.2: break
        yield dict(i=i, name=o['name'], h=h, z=P.enu(la, lo, h)[2], outer=[P.to_px(a, b, h) for a, b in o['outer']],
                   holes=[[P.to_px(a, b, h) for a, b in hole] for hole in o['holes']])


def bake_water():
    """Bird fields for every lake/pond in the painting, and lakeside grass patches for Muscovies (see the module docstring).
    Depth test: post/occlusion.py visible_uv. A bird may only be where it AND the space around it (its sprite) are visible."""
    from PIL import Image, ImageDraw
    from scipy.ndimage import distance_transform_edt, binary_erosion
    vis = np.vectorize(lambda u, v, z, m: O.visible_uv(float(u), float(v), float(z), m), otypes=[bool])
    painted = np.vectorize(lambda u, v: (lambda z: z is not None and z > -500)(O.surface_z(float(u), float(v))), otypes=[bool])   # inside the height pass
    fields, shore = [], []
    for p in water_polys():
        us = [u for u, _ in p['outer']]; vs = [v for _, v in p['outer']]
        if max(us) < EXT[0] or min(us) > EXT[2] or max(vs) < EXT[1] or min(vs) > EXT[3]: continue
        area = abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(p['outer'], p['outer'][1:] + p['outer'][:1]))) / 2 * MPP ** 2 / SQ
        if area < 500: continue
        CELL = 32 if area > 20000 else 8                          # ground px per cell (~4.7 m on lakes, ~1.2 m on ponds)
        u0, g0 = min(us) - 2 * CELL, min(vs) / SQ - 2 * CELL
        w = int((max(us) - u0) / CELL) + 3; h = int((max(vs) / SQ - g0) / CELL) + 3
        def mask(cell, w, h, u0, g0):
            m = Image.new('L', (w, h)); d = ImageDraw.Draw(m)
            tr = lambda pts: [((u - u0) / cell, (v / SQ - g0) / cell) for u, v in pts]
            d.polygon(tr(p['outer']), fill=255)
            for hole in p['holes']: d.polygon(tr(hole), fill=0)
            jj, ii = np.mgrid[0:h, 0:w]; U = u0 + ii * cell; V = (g0 + jj * cell) * SQ
            a = (np.asarray(m) > 0) & (U >= EXT[0]) & (U <= EXT[2]) & (V >= EXT[1]) & (V <= EXT[3])
            return a, U, V
        a, U, V = mask(CELL, w, h, u0, g0)
        # water the camera actually sees (shore trees hang over the edges); a bird stands ~1 m proud of the water, so test
        # its anchor and a point 1.5 m up the screen (its head) with a tight 1.2 m margin
        ok = a.copy(); idx = np.nonzero(a)
        ok[idx] = vis(U[idx], V[idx], p['z'], 1.2) & vis(U[idx], V[idx] - 1.5 * SQ * PXM, p['z'] + 1.5, 1.2) & painted(U[idx], V[idx])
        if ok.sum() * (CELL * MPP) ** 2 / SQ < 300: continue           # outside the painted city (or nearly all hidden)
        dist = np.minimum(60, distance_transform_edt(ok) * CELL * MPP).astype(np.uint8)
        fields.append(dict(name=p['name'], i=p['i'], area=round(area), u0=round(u0, 1), g0=round(g0, 1), cell=CELL, w=w, h=h,
                           d=base64.b64encode(dist.tobytes()).decode()))
        print(f"water {p['i']} {p['name']!r} {area:.0f} m2 z {p['z']:.1f} grid {w}x{h} max dist {dist.max()} m, hidden {1 - ok.sum() / max(1, a.sum()):.0%}")
        if area > 100000:                                          # where people look: the piers and the dam end of the lake
            raw = json.load(open(os.path.join(ROOT, 'data', 'osm', 'water.json')))[p['i']]['outer']
            top = max(a for a, _ in raw)
            pts = [(41.312371, 19.8193537), (41.3123393, 19.8187051), (41.3107462, 19.8128805)] if 'Tiran' in (p['name'] or '') else []   # OSM man_made=pier
            pts += [(a, b) for a, b in raw[::4] if a > top - 0.0009]                             # the dam promenade (north end)
            spots = [[round(u, 1), round(v / SQ, 1)] for u, v in (P.to_px(a, b, p['h']) for a, b in pts)]
            fields[-1]['spots'] = spots; print(f'bird spots: {len(spots)}')
        if area > 100000:                                          # lakeside grass for waddling Muscovies
            C = 8; W2, H2 = w * CELL // C, h * CELL // C          # 1.2 m cells
            a2, U2, V2 = mask(C, W2, H2, u0, g0)
            dw = distance_transform_edt(~a2) * C * MPP
            band = ~a2 & (dw > 2.5) & (dw < 16) & (U2 > EXT[0] + 200) & (U2 < EXT[2] - 200) & (V2 > EXT[1] + 200) & (V2 < EXT[3] - 200)
            # ground level there: the height pass's street-level grid (local minimum), else the water level + 1 m
            ground = np.array([O.ground_z(float(u), float(v)) or p['z'] + 1 for u, v in zip(U2[band], V2[band])])
            okg = np.zeros_like(band); idx = np.nonzero(band)
            okg[idx] = vis(U2[idx], V2[idx], ground, 1.2) & vis(U2[idx], V2[idx] - 1.5 * SQ * PXM, ground + 1.5, 1.2) & painted(U2[idx], V2[idx])
            okg = binary_erosion(okg, iterations=2)               # ~2.4 m clear all round: the whole sprite is in the open
            jj, ii = np.nonzero(okg); rng = np.random.default_rng(3); order = rng.permutation(len(jj))
            anchors = []
            for k in order:
                x, y = U2[jj[k], ii[k]], V2[jj[k], ii[k]] / SQ
                if any(math.hypot(x - ax, y - ay) < 120 * PXM for ax, ay in anchors): continue
                sel = [(j, i) for j, i in zip(jj, ii) if math.hypot(U2[j, i] - x, V2[j, i] / SQ - y) < 8 * PXM]
                if len(sel) < 60: continue
                anchors.append((x, y))
                shore.append(dict(u=[round(float(U2[j, i]), 1) for j, i in sel], v=[round(float(V2[j, i]), 1) for j, i in sel]))
                if len(anchors) >= 6: break
            print(f'shore patches: {len(shore)} ({[len(s["u"]) for s in shore]} points)')
    json.dump(dict(fields=fields, shore=shore), open(os.path.join(OUT, 'water.json'), 'w'), separators=(',', ':'))
    print(f'water.json {os.path.getsize(os.path.join(OUT, "water.json")) / 1024:.0f} KB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    setup()
    bake_water()
    if '--roads' in sys.argv:                                     # the sparse main-road cars
        bake_roads()
