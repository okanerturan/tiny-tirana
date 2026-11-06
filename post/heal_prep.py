"""Cut seam-healing strips for joint.py --heal (block mode leaves hard cuts where a block's pinned strip ends).

    python3 -I post/heal_prep.py STORE OUT_DIR --lines LINES.json --bad BAD.json --axis V|H --shots DIR[,DIR...]
                                 [--min_share 0.1] [--width 1536]

LINES.json: [[axis, coord, share, flagged, total], ...] and BAD.json: [[u, v, axis, ratio], ...] (flagged 256 px
segments) from the seam scan. For every line of the given axis with share >= min_share, the flagged segments are
grown by 1024 px along the line and merged into runs; each run inside the painting becomes one strip:
    {name}_ctrl.jpg  render control (same shots the blocks were painted from)
    {name}_paint.jpg the painting (start point and soft pin)
    {name}_mask.png  255 = keep exactly, 0 = repaint; edges kept, a 384 px ramp, a 512 px free centre over the line
and strips.json with each strip's camera-px rectangle.
"""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from fill_blur import load

Image.MAX_IMAGE_PIXELS = None
T, KEEP, RAMP, STEP = 2048, 128, 384, 256


def shot_index(dirs):
    d = {}
    for sd in dirs:
        for f in os.listdir(sd):
            m = re.match(r'shot_v(-?\d+)_u(-?\d+)\.(png|jpg)$', f)
            if m: d.setdefault((int(m.group(2)), int(m.group(1))), os.path.join(sd, f))
    return d


def assemble(u, v, w, h, idx):
    """Render for [u, u+w) x [v, v+h) from the 2048 px shots on the 1024 lattice (as sampler/blocks.py)."""
    out = np.zeros((h, w, 3), np.uint8); filled = np.zeros((h, w), bool)
    for cv in range(((v - T + 1) // 1024) * 1024, v + h, 1024):
        for cu in range(((u - T + 1) // 1024) * 1024, u + w, 1024):
            f = idx.get((cu, cv))
            if not f: continue
            x0, y0, x1, y1 = max(u, cu), max(v, cv), min(u + w, cu + T), min(v + h, cv + T)
            if x0 >= x1 or y0 >= y1: continue
            sub = filled[y0 - v:y1 - v, x0 - u:x1 - u]
            if sub.all(): continue
            img = np.asarray(Image.open(f).convert('RGB'))[y0 - cv:y1 - cv, x0 - cu:x1 - cu]
            out[y0 - v:y1 - v, x0 - u:x1 - u][~sub] = img[~sub]; sub[:] = True
    if not filled.all(): raise FileNotFoundError(f'strip u={u} v={v} {w}x{h}: {100 * (1 - filled.mean()):.1f}% has no shot')
    return out


def painted(store, u, v, w, h):
    m = np.zeros((h, w), bool)
    for cv in range((v // T) * T, v + h, T):
        for cu in range((u // T) * T, u + w, T):
            p = f'{store}/m_v{cv}_u{cu}.png'
            if not os.path.exists(p): continue
            a = np.asarray(Image.open(p).convert('L')) >= 128
            x0, y0, x1, y1 = max(u, cu), max(v, cv), min(u + w, cu + T), min(v + h, cv + T)
            m[y0 - v:y1 - v, x0 - u:x1 - u] = a[y0 - cv:y1 - cv, x0 - cu:x1 - cu]
    return m


def profile(n):
    """Across-line keep weight for a strip n px wide: 1 at the edges, ramp, 0 in the middle."""
    x = np.arange(n) + 0.5; d = np.minimum(x, n - x)                 # distance to the nearer strip edge
    return np.clip(1 - (d - KEEP) / RAMP, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('store'); ap.add_argument('out'); ap.add_argument('--lines', required=True); ap.add_argument('--bad', required=True)
    ap.add_argument('--axis', required=True, choices=['V', 'H']); ap.add_argument('--shots', required=True)
    ap.add_argument('--min_share', type=float, default=0.1); ap.add_argument('--width', type=int, default=1536)
    ap.add_argument('--grow', type=int, default=1024); ap.add_argument('--prefix', default='s')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    idx = shot_index(a.shots.split(',')); Wd = a.width; half = Wd // 2
    lines = [(ax, c) for ax, c, share, *_ in json.load(open(a.lines)) if ax == a.axis and share >= a.min_share]
    bad = json.load(open(a.bad)); strips = {}
    for ax, c in lines:
        segs = sorted((v if ax == 'V' else u) for u, v, axx, r in bad if axx == ax and (u if ax == 'V' else v) == c)
        runs = []
        for s in segs:
            lo, hi = s - a.grow, s + STEP + a.grow
            if runs and lo <= runs[-1][1]: runs[-1][1] = max(runs[-1][1], hi)
            else: runs.append([lo, hi])
        for lo, hi in runs:
            lo, hi = (lo // 16) * 16, -(-hi // 16) * 16
            # clip the run to where the whole strip width is painted
            u, v, w, h = (c - half, lo, Wd, hi - lo) if ax == 'V' else (lo, c - half, hi - lo, Wd)
            pm = painted(a.store, u, v, w, h)
            ok = pm.all(axis=1) if ax == 'V' else pm.all(axis=0)                  # along-line positions fully painted
            if not ok.any(): continue
            i0 = int(np.argmax(ok)); i1 = len(ok) - int(np.argmax(ok[::-1]))
            i0 = -(-i0 // 16) * 16; i1 = (i1 // 16) * 16
            if i1 - i0 < 1024: continue
            lo2, hi2 = lo + i0, lo + i1
            u, v, w, h = (c - half, lo2, Wd, hi2 - lo2) if ax == 'V' else (lo2, c - half, hi2 - lo2, Wd)
            name = f'{a.prefix}{ax}{c}_{lo2}'
            paint = load(a.store, u, v, u + w, v + h); ctrl = assemble(u, v, w, h, idx)
            across = profile(Wd); L = hi2 - lo2
            along = np.ones(L)                                                       # ramp back to the original at run ends
            t = np.arange(L) + 0.5
            if i0 == 0: along = np.minimum(along, np.clip(t / RAMP, 0, 1))
            if i1 == len(ok): along = np.minimum(along, np.clip((L - t) / RAMP, 0, 1))
            keep = np.maximum(across[None, :], 1 - along[:, None]) if ax == 'V' else np.maximum(across[:, None], 1 - along[None, :])
            Image.fromarray(ctrl).save(f'{a.out}/{name}_ctrl.jpg', quality=93)
            Image.fromarray(paint).save(f'{a.out}/{name}_paint.jpg', quality=95)
            Image.fromarray((keep * 255).round().astype(np.uint8)).save(f'{a.out}/{name}_mask.png')
            strips[name] = [u, v, w, h]; print(name, w, 'x', h)
    json.dump(strips, open(f'{a.out}/strips.json', 'w'), indent=1)
    print(len(strips), 'strips,', round(sum(w * h for _, _, w, h in strips.values()) / 1e6), 'Mpx')


if __name__ == '__main__':
    main()
