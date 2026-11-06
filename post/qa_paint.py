"""Acceptance test for a painted tile store: seams on block lines and Google-blurred patches.

    python3 -I post/qa_paint.py STORE [--allow u0,v0,u1,v1;...] [--json OUT.json]

1. Seams. Block edges all lie on the 1024 px lattice. For every lattice line, in 256 px segments where both sides are
   painted, the pixel step across the line is compared with the steps 3-6 px beside it (ratio). The same is measured
   on CONTROL lines offset by 512 px, where no block edge can be. A line FAILS if its share of segments with
   ratio > 1.6 exceeds the worst control line's share + 0.03 (lines with >= 8 segments). Before healing, block lines
   scored up to 99 %; control lines score <= ~3 %.
2. Blurred patches. 128 px cells (measured at 1/4 resolution) with almost no fine detail, outside OSM water; clusters
   of >= 3 cells FAIL unless they lie inside an --allow box (checked false positives: ponds, sports pitches).
Exits 1 on any failure.
"""
import argparse, json, os, re, sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import water as W

T, SEG, TH = 2048, 256, 1.6


def tiles(S):
    return {(int(m.group(2)), int(m.group(1))) for f in os.listdir(S) if (m := re.match(r't_v(-?\d+)_u(-?\d+)\.png$', f))}


def L(S, u, v):
    return (np.asarray(Image.open(f'{S}/t_v{v}_u{u}.png').convert('L'), np.float32),
            np.asarray(Image.open(f'{S}/m_v{v}_u{u}.png').convert('L')) >= 128)


def segs(a, m, x):
    """Ratios for the vertical line just left of column x, in SEG-tall segments fully painted 7 px each side."""
    out = []
    for s0 in range(0, a.shape[0], SEG):
        sl = slice(s0, s0 + SEG)
        if not m[sl, x - 7:x + 7].all(): continue
        st = lambda i: np.abs(a[sl, i] - a[sl, i - 1]).mean()
        out.append((s0, st(x) / max(np.mean([st(x + j) for j in (-6, -5, -4, -3, 3, 4, 5, 6)]), 1e-3)))
    return out


def seam_scan(S, have, offsets):
    def scan(t):
        u, v = t; a, m = L(S, u, v); res = []
        for x in (o for o in offsets if o > 0):                  # internal lines of this tile (edges: below)
            res += [('V', u + x, r) for _, r in segs(a, m, x)] + [('H', v + x, r) for _, r in segs(a.T, m.T, x)]
        if 0 in offsets:                                         # tile edges, using the neighbour
            if (u - T, v) in have:
                b, bm = L(S, u - T, v)
                res += [('V', u, r) for _, r in segs(np.c_[b[:, -16:], a[:, :16]], np.c_[bm[:, -16:], m[:, :16]], 16)]
            if (u, v - T) in have:
                b, bm = L(S, u, v - T)
                res += [('H', v, r) for _, r in segs(np.r_[b[-16:], a[:16]].T, np.r_[bm[-16:], m[:16]].T, 16)]
        return res
    with ThreadPoolExecutor(8) as ex: allr = [r for rr in ex.map(scan, sorted(have)) for r in rr]
    tot, bad = Counter(), Counter()
    for ax, c, r in allr: tot[(ax, c)] += 1; bad[(ax, c)] += r > TH
    return {k: (bad[k] / tot[k], tot[k]) for k in tot}


def blur_scan(S, have):
    F, C = 4, 32
    def scan(t):
        u, v = t; im = Image.open(f'{S}/t_v{v}_u{u}.png').convert('L').resize((T // F, T // F), Image.BOX)
        mk = np.asarray(Image.open(f'{S}/m_v{v}_u{u}.png').convert('L').resize((T // F, T // F)))
        g = np.asarray(im, np.float32); hp = np.abs(g - np.asarray(im.filter(ImageFilter.GaussianBlur(1.5)), np.float32))
        return [(u + x * F, v + y * F) for y in range(0, T // F, C) for x in range(0, T // F, C)
                if mk[y:y + C, x:x + C].mean() >= 200 and hp[y:y + C, x:x + C].mean() < 2.6]
    with ThreadPoolExecutor(8) as ex: cells = [c for r in ex.map(scan, sorted(have)) for c in r]
    cells = {c for c in cells if W.water_mask(c[0], c[1], 128, 128, 0, 0, 4).mean() <= 60}
    seen, out = set(), []
    for s in cells:
        if s in seen: continue
        st, grp = [s], []; seen.add(s)
        while st:
            p = st.pop(); grp.append(p)
            for du in (-128, 0, 128):
                for dv in (-128, 0, 128):
                    q = (p[0] + du, p[1] + dv)
                    if q in cells and q not in seen: seen.add(q); st.append(q)
        if len(grp) >= 3: out.append((len(grp), min(g[0] for g in grp), min(g[1] for g in grp), max(g[0] for g in grp) + 128, max(g[1] for g in grp) + 128))
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('store'); ap.add_argument('--allow', default=''); ap.add_argument('--json')
    a = ap.parse_args(); S = a.store; have = tiles(S); fails = 0
    allow = [tuple(map(int, b.split(','))) for b in a.allow.split(';') if b]
    lat = seam_scan(S, have, (0, 1024)); ctl = seam_scan(S, have, (512, 1536))
    ctl_worst = max(s for s, n in ctl.values() if n >= 8)
    worst = sorted(((s, n, k) for k, (s, n) in lat.items() if n >= 8), reverse=True)
    limit = ctl_worst + 0.03
    print(f'seams: {len(lat)} lattice lines, {len(ctl)} control lines; worst control share {ctl_worst:.3f}, limit {limit:.3f}')
    for s, n, k in worst[:5]: print(f'   {k[0]} {k[1]}: {s:.3f} of {n} segments {"FAIL" if s > limit else "ok"}')
    nf = sum(s > limit for s, n, k in worst); fails += nf
    print(f'seams: {"PASS" if not nf else f"FAIL ({nf} lines)"}')
    bl = blur_scan(S, have)
    inside = lambda c, b: c[1] >= b[0] and c[2] >= b[1] and c[3] <= b[2] and c[4] <= b[3]
    nb = [c for c in bl if not any(inside(c, b) for b in allow)]
    for c in bl: print(f'   blur cluster {c} {"allowed" if c not in nb else "FAIL"}')
    print(f'blur: {"PASS" if not nb else f"FAIL ({len(nb)} clusters)"}'); fails += len(nb)
    if a.json: json.dump({'ctl_worst': ctl_worst, 'worst': [[k[0], k[1], s, n] for s, n, k in worst[:20]], 'blur': bl}, open(a.json, 'w'))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
