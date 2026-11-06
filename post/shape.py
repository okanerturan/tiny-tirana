"""Cut the painting to the shape of Tirana: the 11 urban units, the corridor to the airport and an island around the
runway, with an organic coastline. Everything outside becomes transparent (the app shows clouds there).

    python3 -I post/shape.py SRC_STORE OUT_STORE [--preview OUT.jpg]

OUT_STORE gets a symlink to every image tile of SRC_STORE plus a new mask m_ per tile (painted AND inside the shape,
with a soft 3 px edge); tiles wholly outside are left out. The outline is a smooth signed field computed at 1/16 scale
(distance to the shape, minus a growth margin, minus layered noise) and interpolated to full resolution, so the coast is
curved and organic rather than blocky. Same seed -> same coast.
"""
import json, math, os, re, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, os.path.join(ROOT, 'render')); sys.path.insert(0, HERE)
import project as P, terrain as Tn

T, F = 2048, 16
URB_CLOSE, URB_MIN, URB_NEAR = 15, 3000, 220                   # cells: ~40 m merge, ~2 ha smallest patch, ~600 m from the units
GROW, NOISE_AMP, NOISE_SCALE, SEED = 22, 30, 150, 7          # in 1/16 cells: ~52 m margin, ~70 m wobble, ~350 m features


def tiles(st):
    return [(int(m.group(2)), int(m.group(1))) for f in os.listdir(st) if (m := re.match(r't_v(-?\d+)_u(-?\d+)\.png$', f))]


def main():
    src, out = sys.argv[1], sys.argv[2]; prev = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    have = tiles(src); U0 = min(u for u, _ in have); V0 = min(v for _, v in have)
    U1 = max(u for u, _ in have) + T; V1 = max(v for _, v in have) + T; W, H = (U1 - U0) // F, (V1 - V0) // F
    # painted mask at 1/16 (the shape never adds land that was not painted)
    painted = np.zeros((H, W), bool); s = T // F
    def rd(t):
        u, v = t; return u, v, np.asarray(Image.open(f'{src}/m_v{v}_u{u}.png').convert('L').resize((s, s), Image.BOX)) > 127
    with ThreadPoolExecutor(8) as ex:
        for u, v, m in ex.map(rd, have): painted[(v - V0) // F:(v - V0) // F + s, (u - U0) // F:(u - U0) // F + s] |= m
    # the land: urban units + the painted corridor + an ellipse along runway 17/35
    B = json.load(open(os.path.join(ROOT, 'data', 'osm', 'boundaries.json'))); im = Image.new('L', (W, H)); dr = ImageDraw.Draw(im)
    for n, poly in B['units'].items():
        if n.startswith('Njësia Bashkiake'):
            dr.polygon([((x - U0) / F, (y - V0) / F) for x, y in (P.to_px(la, lo, Tn.elev(la, lo)) for la, lo in poly)], fill=255)
    land = np.asarray(im) > 0
    # built-up fabric near the units (data/urban_polys.npz from post/urban_bake.py): the coast should run where the
    # city gives way to fields or forest, not through dense blocks just because an administrative line runs there
    up = os.path.join(ROOT, 'data', 'urban_polys.npz')
    if os.path.exists(up):
        Z = np.load(up); xy, st = Z['xy'], list(Z['start']) + [len(Z['xy'])]
        um = Image.new('L', (W, H)); ud = ImageDraw.Draw(um)
        for a0, a1 in zip(st, st[1:]):
            if a1 - a0 >= 3: ud.polygon([((x - U0) / F, (y - V0) / F) for x, y in xy[a0:a1]], fill=255)
        urban = np.asarray(um) > 0
        dil = ndimage.distance_transform_edt(~urban) <= URB_CLOSE                # closing via distance transforms:
        urban = ndimage.distance_transform_edt(dil) > URB_CLOSE                  # buildings ~40 m apart become one fabric
        lab, n = ndimage.label(urban)
        if n:
            sz = ndimage.sum(urban, lab, range(1, n + 1)); urban = np.isin(lab, 1 + np.flatnonzero(sz >= URB_MIN))   # no lone farmhouses
        urban = ndimage.binary_fill_holes(urban)
        near = ndimage.distance_transform_edt(~land) <= URB_NEAR
        add = urban & near & painted
        print(f'  built-up fabric: +{(add & ~land).sum() * (F * 300 / 2048) ** 2 * math.sqrt(2) / 1e6:.1f} km2 next to the units')
        land |= add
    # land beyond the units: "worms" along polylines (data/shape_land.json), each disc as big as rmax allows while
    # staying MARGIN cells inside the painting, so connectors are smooth and never reach unpainted ground
    extra = json.load(open(os.path.join(ROOT, 'data', 'shape_land.json')))
    holes = ndimage.binary_fill_holes(painted) & ~painted; lab, nh = ndimage.label(holes)
    if nh:                                                              # specks inside the painting are not coast
        sz = ndimage.sum(holes, lab, range(1, nh + 1)); painted = painted | np.isin(lab, 1 + np.flatnonzero(sz < 4000))
    inner = ndimage.distance_transform_edt(painted); MARGIN = GROW + 1.6 * NOISE_AMP + 8
    wm = Image.new('L', (W, H)); wd = ImageDraw.Draw(wm)
    for name, w in extra['worms'].items():
        pts = [P.to_px(q['lat'], q['lon'], Tn.elev(q['lat'], q['lon'])) if isinstance(q, dict) else q for q in w['pts']]
        pts = [((x - U0) / F, (y - V0) / F) for x, y in pts]; seq = []
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 2))
            seq += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n) for k in range(n)]
        seq.append(pts[-1])
        r = np.array([min(w['rmax'] / F, inner[min(H - 1, max(0, int(y))), min(W - 1, max(0, int(x)))] - MARGIN) for x, y in seq])
        lim = r.copy(); r = ndimage.uniform_filter1d(ndimage.minimum_filter1d(r, 31), 25)   # no sudden pinches or bulges
        r = np.minimum(r, lim)                                          # smoothing never pushes a disc past its limit
        for (x, y), rr in zip(seq, r):
            if rr > 2: wd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)
        print(f'  worm {name}: {len(seq)} steps, radius {r.min() * F:.0f}..{r.max() * F:.0f} px')
    land |= np.asarray(wm) > 0
    S_, N_ = P.to_px(41.4024, 19.7222, 119), P.to_px(41.4270, 19.7189, 119)
    cx, cy = (S_[0] + N_[0]) / 2, (S_[1] + N_[1]) / 2; L = math.hypot(N_[0] - S_[0], N_[1] - S_[1])
    ux, uy = (N_[0] - S_[0]) / L, (N_[1] - S_[1]) / L
    yy, xx = np.mgrid[0:H, 0:W]; X = U0 + xx * F - cx; Y = V0 + yy * F - cy
    land |= ((X * ux + Y * uy) / (L * 0.62)) ** 2 + ((-X * uy + Y * ux) / (L * 0.36)) ** 2 < 1
    # signed field (cells; < 0 = inside), organic coast
    rng = np.random.default_rng(SEED); nz = np.zeros((H, W)); amp = 1.0
    for o in range(4):
        sc = max(2, int(NOISE_SCALE / 2 ** o)); g = rng.standard_normal((H // sc + 2, W // sc + 2)).astype(np.float32)
        nz += amp * np.asarray(Image.fromarray(g).resize((W + sc, H + sc), Image.BICUBIC))[:H, :W]; amp *= 0.5
    nz /= 1.9
    land = ndimage.binary_fill_holes(land)                             # slivers between neighbouring units are not coast
    field = ndimage.distance_transform_edt(~land) - ndimage.distance_transform_edt(land) - GROW
    gL = np.random.default_rng(SEED + 1).standard_normal((H // 400 + 2, W // 400 + 2)).astype(np.float32)
    bays = np.clip(np.asarray(Image.fromarray(gL).resize((W + 400, H + 400), Image.BICUBIC))[:H, :W], 0, None)
    field = np.maximum(field, 1.8 * NOISE_AMP + 4 + 110 * bays - inner)   # keep the noise's reach inside the painting, with wide
    # bays where the land runs along the painting's edge (else that edge reads as a long straight line); before the noise,
    field = field - nz * NOISE_AMP                                     # so a coast that follows a painted edge still wobbles)
    field = np.where(painted, field, np.maximum(field, 1.0))            # never land where nothing was painted
    field = ndimage.gaussian_filter(field, 0.8).astype(np.float32)
    inside = field < 0
    lab, n = ndimage.label(inside)                                      # one landmass: no stray islets off the coast
    if n > 1:
        sz = ndimage.sum(inside, lab, range(1, n + 1)); field[(lab > 0) & (lab != 1 + int(np.argmax(sz)))] = 1.0; inside = field < 0
    ponds = ndimage.binary_fill_holes(inside) & ~inside & painted; lab, n = ndimage.label(ponds)   # no small cloud ponds inland
    if n:
        sz = ndimage.sum(ponds, lab, range(1, n + 1)); fill = np.isin(lab, 1 + np.flatnonzero(sz < 4000))
        field[fill] = np.minimum(field[fill], -1.0); inside = field < 0
    print(f'canvas u {U0}..{U1} v {V0}..{V1}; land {inside.sum() * (F * 300 / 2048) ** 2 * math.sqrt(2) / 1e6:.0f} km2 of '
          f'{painted.sum() * (F * 300 / 2048) ** 2 * math.sqrt(2) / 1e6:.0f} painted')
    if prev:
        Image.fromarray(np.where(inside, 255, np.where(painted, 90, 0)).astype(np.uint8)).save(prev); print('preview', prev)
        if '--dry' in sys.argv: return
    # per tile: interpolate the field to full resolution -> soft edge -> new mask
    os.makedirs(out, exist_ok=True)
    fpad = np.pad(field, 1, mode='edge')
    def cut(t):
        u, v = t; x0, y0 = (u - U0) // F, (v - V0) // F
        sub = fpad[y0:y0 + s + 2, x0:x0 + s + 2]                         # cells around the tile (1-cell apron)
        if sub.min() > 0.5: return 0                                    # wholly outside
        f = np.asarray(Image.fromarray(sub).resize(((s + 2) * F, (s + 2) * F), Image.BILINEAR))[F:F + T, F:F + T]
        a = np.clip(0.5 - f * F / 3.0, 0, 1)                            # 3 px soft coast
        m = np.asarray(Image.open(f'{src}/m_v{v}_u{u}.png').convert('L'), np.float32) / 255
        mm = (m * a * 255).round().astype(np.uint8)
        if mm.max() == 0: return 0
        dst = os.path.join(out, f't_v{v}_u{u}.png')
        if not os.path.lexists(dst): os.symlink(os.path.abspath(f'{src}/t_v{v}_u{u}.png'), dst)
        Image.fromarray(mm).save(os.path.join(out, f'm_v{v}_u{u}.png')); return 1
    with ThreadPoolExecutor(8) as ex: n = sum(ex.map(cut, have))
    print(f'{n} of {len(have)} tiles kept in {out}')


if __name__ == '__main__':
    main()
