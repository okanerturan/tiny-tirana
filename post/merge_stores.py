"""Merge block-painter tile stores (t_/m_ PNG pairs on the 2048 camera-px grid) into one, mask-aware.

    python3 -I post/merge_stores.py DST SRC [SRC ...]              # copy/merge every tile of each SRC into DST
    python3 -I post/merge_stores.py --subset PLAN.json --tar OUT.tar STORE
        # pack only the tiles of STORE that overlap the blocks in PLAN (for the seam pass), as big_store/<files>

Where both stores have a tile, painted pixels are combined: a pixel painted in the source but not in the
destination is taken from the source; a pixel painted in both keeps the destination's (first painter wins,
as in blocks.py, so pinned borders never change).
"""
import json, os, re, shutil, sys, tarfile
import numpy as np
from PIL import Image

T = 2048


def tiles(store):
    for f in os.listdir(store):
        m = re.match(r't_v(-?\d+)_u(-?\d+)\.png$', f)
        if m: yield int(m.group(2)), int(m.group(1))


def merge(dst, srcs):
    os.makedirs(dst, exist_ok=True); n = c = 0
    for src in srcs:
        for u, v in tiles(src):
            t, m = f't_v{v}_u{u}.png', f'm_v{v}_u{u}.png'
            if not os.path.exists(os.path.join(dst, t)):
                shutil.copy2(os.path.join(src, t), os.path.join(dst, t))
                if os.path.exists(os.path.join(src, m)): shutil.copy2(os.path.join(src, m), os.path.join(dst, m))
                n += 1; continue
            a = np.asarray(Image.open(os.path.join(dst, t)).convert('RGB')).copy(); am = np.asarray(Image.open(os.path.join(dst, m)).convert('L')).copy()
            b = np.asarray(Image.open(os.path.join(src, t)).convert('RGB')); bm = np.asarray(Image.open(os.path.join(src, m)).convert('L'))
            take = (am < 128) & (bm >= 128)
            if take.any():
                a[take] = b[take]; am[take] = 255
                Image.fromarray(a).save(os.path.join(dst, t), compress_level=1); Image.fromarray(am).save(os.path.join(dst, m))
            c += 1
        for f in os.listdir(src):
            if f.startswith('done_') and not os.path.exists(os.path.join(dst, f)): shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
    print(f'merged into {dst}: {n} new tiles, {c} combined')


def subset(plan, out, store):
    P = json.load(open(plan)); S = P['S']; need = set()
    for b in P['blocks']:
        for cv in range((b['v'] // T) * T, b['v'] + S, T):
            for cu in range((b['u'] // T) * T, b['u'] + S, T): need.add((cu, cv))
    have = [(u, v) for u, v in tiles(store) if (u, v) in need]
    with tarfile.open(out, 'w') as tf:
        for u, v in have:
            for k in ('t', 'm'):
                f = os.path.join(store, f'{k}_v{v}_u{u}.png')
                if os.path.exists(f): tf.add(f, arcname=f'big_store/{k}_v{v}_u{u}.png')
    print(f'{out}: {len(have)} of {len(need)} seam-area tiles exist in {store}')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == '--subset':
        subset(a[1], a[3], a[4])
    else:
        merge(a[0], a[1:])
