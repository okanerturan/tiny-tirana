"""Is a ground point visible from the map camera, or hidden behind a building or tree? (a depth test on the height pass)

The renderer's height pass (render.js --height 1) stores, per pixel, the local height (ENU z at the anchor) of the
surface the camera actually sees. A point on a road is visible where that surface is about as high as the road;
if a roof or a tree canopy several metres higher sits on that pixel, the road there is hidden.

    import occlusion as O
    O.load('data/render/height_main')           # once (builds a cached half-res grid in data/occlusion_<name>.npz)
    O.visible(lat, lon, h_ellipsoidal)          # -> True / False
    O.visible_uv(u, v, z_enu)                   # same, from camera px + ENU z (see render/project.py enu())
    O.road_point(lat, lon)                      # -> (u, v, h_ellipsoidal) snapped to the real street level, or None

Why road_point: the free DEM (post/terrain.py) is a SURFACE model in the city (it includes buildings), so it puts
streets metres too high, and every metre too high moves a point ~5 px up the screen. Streets are the lowest visible
surface around them, so the street level is a local minimum of the height pass (over ~35 m), read where the point
projects; a few fixed-point steps make the projection and the height agree.
Build the cache from the command line:  python3 -I post/occlusion.py data/render/height_main
"""
import glob, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'render'))
import project as P
from heights import decode

SCALE, S = 2, 2048    # default grid resolution: half the camera px (big areas use 4)
MARGIN = 3.0          # metres a surface may stand above the road before it counts as hiding it (kerbs, the vehicle itself)
_grids = []           # [{g: ENU z of the visible surface, ground: street level, u0, v0, s: px per cell}]
_g = None             # first grid as (g, u0, v0), kept for older callers


def build(d, scale=SCALE):
    files = glob.glob(os.path.join(d, 'shot_v*_u*_height.png'))
    uv = [tuple(map(int, re.search(r'shot_v(-?\d+)_u(-?\d+)_height', f).groups()))[::-1] for f in files]
    u0, v0 = min(u for u, _ in uv), min(v for _, v in uv)
    u1, v1 = max(u for u, _ in uv) + S, max(v for _, v in uv) + S
    g = np.full(((v1 - v0) // scale, (u1 - u0) // scale), np.nan, np.float32)
    for f, (u, v) in zip(files, uv):
        h = decode(f)[::scale, ::scale]
        r, c = (v - v0) // scale, (u - u0) // scale
        g[r:r + h.shape[0], c:c + h.shape[1]] = h
    # a road pixel is hidden only if the occluder is also there at the neighbouring samples (kills single noisy texels)
    from scipy.ndimage import minimum_filter, percentile_filter, zoom
    g = minimum_filter(np.nan_to_num(g, nan=-1e3), size=3).astype(np.float16)
    # street level = 10th percentile of the visible surface over ~25 m, computed at ~1.2 m cells, sampled back
    step = max(1, 8 // scale)
    small = g[::step, ::step].astype(np.float32)
    small = np.where(small < -500, np.nan, small)
    small = np.where(np.isnan(small), np.nanmedian(small), small)
    gs = percentile_filter(small, 10, size=21)
    gr = zoom(gs, (g.shape[0] / gs.shape[0], g.shape[1] / gs.shape[1]), order=1).astype(np.float16)
    name = os.path.basename(os.path.normpath(d))
    np.savez_compressed(os.path.join(HERE, '..', 'data', f'occlusion_{name}.npz'), g=g, ground=gr, u0=u0, v0=v0, s=scale)
    return {'g': g, 'ground': gr, 'u0': u0, 'v0': v0, 's': scale}


def load(d, scale=SCALE):
    """Load one height-pass dir or a list of them (e.g. the city and the airport); builds missing caches."""
    global _grids, _g, _ground
    _grids = []
    for one in ([d] if isinstance(d, str) else d):
        name = os.path.basename(os.path.normpath(one)); f = os.path.join(HERE, '..', 'data', f'occlusion_{name}.npz')
        if os.path.exists(f):
            z = np.load(f); _grids.append({'g': z['g'], 'ground': z['ground'], 'u0': int(z['u0']), 'v0': int(z['v0']), 's': int(z['s']) if 's' in z else 2})
        else:
            _grids.append(build(one, scale))
    _g = (_grids[0]['g'], _grids[0]['u0'], _grids[0]['v0']); _ground = _grids[0]['ground']
    return _g


def _cell(u, v):
    for G in _grids:
        r, c = int((v - G['v0']) // G['s']), int((u - G['u0']) // G['s'])
        if 0 <= r < G['g'].shape[0] and 0 <= c < G['g'].shape[1]:
            return G, r, c
    return None, 0, 0


def surface_z(u, v):
    G, r, c = _cell(u, v)
    if G is None: return None                # outside every height pass: unknown (treat as visible)
    return float(G['g'][r, c])


def ground_z(u, v):
    G, r, c = _cell(u, v)
    if G is None: return None
    z = float(G['ground'][r, c]); return None if z < -500 else z


def road_point(lat, lon, h0=None, span=45.0, step=0.5):
    """(u, v, h) of a street point at its true height (ellipsoidal h), or None if no consistent height exists.

    Solves f(h) = street_level(px(lat, lon, h)) - enu_z(h) = 0 by scanning h over prior +- span (prior = the DEM
    minus its ~8 m city bias, or h0). Fixed-point iteration is NOT used: when a guess lands on a big roof it bounces
    between roof and street and can stop at nonsense (seen: 279 m). Among the roots, the one closest to the prior wins.
    """
    if h0 is None:
        try:
            import terrain as T
            prior = T.elev(lat, lon) - 8.0
        except Exception:
            prior = P.CAM['groundH'] - 9.0
    else:
        prior = h0
    hs = np.arange(prior - span, prior + span + step, step)
    f = []
    for h in hs:
        u, v = P.to_px(lat, lon, float(h)); z = ground_z(u, v)
        f.append(np.nan if z is None else z - P.enu(lat, lon, float(h))[2])
    f = np.array(f)
    roots = []
    for i in range(len(hs) - 1):
        a_, b_ = f[i], f[i + 1]
        if np.isnan(a_) or np.isnan(b_): continue
        if a_ == 0 or (a_ > 0) != (b_ > 0):
            t = a_ / (a_ - b_) if a_ != b_ else 0.0
            roots.append(hs[i] + t * step)
    if not roots:
        return None
    h = float(min(roots, key=lambda r: abs(r - prior)))
    u, v = P.to_px(lat, lon, h)
    return u, v, h


def road_profile(d, h, step=4.0, med_m=200.0, smooth_m=40.0):
    """Heights along a line as a road would have them: a running median over ~med_m (drops jumps up to ~100 m long from trees, buildings,
    noise), then a Gaussian over ~smooth_m. Positions on the map never change, only heights, so the line on screen can
    only get straighter; real slopes (gentle over tens of metres) survive."""
    d = np.asarray(d, float); h = np.asarray(h, float)
    if len(d) < 3 or d[-1] - d[0] < 2 * step: return h
    g = np.arange(d[0], d[-1] + step, step); hg = np.interp(g, d, h)
    r = max(1, int(med_m / step / 2)); pad = np.pad(hg, r, mode='edge')
    med = np.array([np.median(pad[i:i + 2 * r + 1]) for i in range(len(hg))])
    sig = smooth_m / step / 2; k = np.arange(-int(3 * sig), int(3 * sig) + 1); w = np.exp(-k ** 2 / (2 * sig ** 2)); w /= w.sum()
    sm = np.convolve(np.pad(med, len(k) // 2, mode='edge'), w, mode='valid')
    return np.interp(d, g, sm)


CANOPY_M = 4.5          # line_heights: a visible sample this far above the DEM street prior is tree canopy


def line_heights(pts, step_m=None, elevated=False):
    """Street heights along a polyline [(lat, lon), ...] that stay straight behind tall buildings.

    road_point is only trusted where the snapped street is actually VISIBLE (the camera sees a surface at street level
    there). Behind a tower the local street-level estimate is polluted by the tower itself and would lift the road
    (a kink drawn over the building), so hidden samples get heights linearly interpolated, by distance along the
    line, between the nearest visible samples. Returns [(u, v, h)] (camera px + ellipsoidal h), one per input point;
    None-safe: falls back to terrain.elev - 8 m where nothing is known.
    elevated=True (OSM bridge / layer > 0: flyovers, viaducts): a surface high above the DEM street level IS the deck
    there, so it is not rejected as tree canopy, and the long running median (which would flatten a deck shorter than
    ~100 m back to the ground) is replaced by a short one.
    """
    import math
    n = len(pts); hs = [None] * n; vis = [False] * n
    try:
        import terrain as T
        prior = lambda la, lo: T.elev(la, lo) - 8                       # street level from the DEM (a DSM, ~8 m high in town)
    except Exception:
        prior = None
    for i, (la, lo) in enumerate(pts):
        rp = road_point(la, lo)
        if rp is None: continue
        u, v, h = rp; hs[i] = h
        vis[i] = visible_uv(u, v, P.enu(la, lo, h)[2], margin=1.5)
        # a "visible" surface far above the street is tree canopy over a hidden road (lining avenues), not the road:
        # trusting it lifts the whole stretch onto the trees. Treat it as hidden, so it is interpolated from real street.
        if vis[i] and not elevated and prior is not None and h > prior(la, lo) + CANOPY_M: vis[i] = False
    d = [0.0]
    for (a, b), (c, e) in zip(pts, pts[1:]):
        d.append(d[-1] + math.hypot((c - a) * 111320, (e - b) * 111320 * math.cos(math.radians(a))))
    good = [i for i in range(n) if vis[i] and hs[i] is not None]
    if not good:
        try:
            import terrain as T
            return [(*P.to_px(la, lo, T.elev(la, lo) - 8), T.elev(la, lo) - 8) for la, lo in pts]
        except Exception:
            good = [i for i in range(n) if hs[i] is not None]
            if not good: return [(*P.to_px(la, lo, P.CAM['groundH'] - 9), P.CAM['groundH'] - 9) for la, lo in pts]
    hi = np.interp(d, [d[i] for i in good], [hs[i] for i in good])     # linear between visible samples, flat beyond the ends
    hi = road_profile(d, hi, med_m=24.0 if elevated else 200.0)         # a road's height changes slowly: keep straight streets straight
    out = []
    for (la, lo), h in zip(pts, hi):
        u, v = P.to_px(la, lo, float(h)); out.append((u, v, float(h)))
    return out


def visible_uv(u, v, z_enu, margin=MARGIN):
    s = surface_z(u, v)
    return s is None or s < -500 or s <= z_enu + margin


def visible(lat, lon, h, margin=MARGIN):
    u, v = P.to_px(lat, lon, h)
    return visible_uv(u, v, P.enu(lat, lon, h)[2], margin)


if __name__ == '__main__':
    G = build(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else SCALE); g, u0, v0 = G['g'], G['u0'], G['v0']
    print('occlusion grid', g.shape, 'origin', u0, v0, 'valid', round(float(np.mean(g > -500)), 3))
