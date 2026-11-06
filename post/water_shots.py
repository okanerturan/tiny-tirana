"""Clean every lake/pond in a folder of 2048 px render shots (camera px names shot_v{v}_u{u}.png) -> OUT (hard links for untouched shots).
Each water body is flattened on a mosaic of the shots it touches, so its calm colour is continuous across shot edges.
    python3 -I post/water_shots.py data/render/big data/render/big_clean
"""
import os, re, sys, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import water as Wt
T = 2048
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
shots = {}
for f in os.listdir(src):
    m = re.match(r'shot_v(-?\d+)_u(-?\d+)\.png$', f)
    if m: shots[(int(m.group(2)), int(m.group(1)))] = f
for (u, v), f in shots.items():
    if not os.path.exists(os.path.join(dst, f)): os.link(os.path.join(src, f), os.path.join(dst, f))
done = 0
for p in Wt.polys():
    us = [a for a, _ in p['outer']]; vs = [b for _, b in p['outer']]
    u0, v0 = (int(min(us)) - 64) // 1024 * 1024, (int(min(vs)) - 64) // 1024 * 1024     # shots sit on a 1024 px lattice
    u1, v1 = -(-(int(max(us)) + 64) // 1024) * 1024, -(-(int(max(vs)) + 64) // 1024) * 1024
    # every shot that overlaps the window, on either grid
    cells = [(a, b) for (a, b) in shots if a < u1 and a + T > u0 and b < v1 and b + T > v0]
    if not cells: continue
    U0w, V0w = min([u0] + [a for a, _ in cells]), min([v0] + [b for _, b in cells])
    U1w, V1w = max([u1] + [a + T for a, _ in cells]), max([v1] + [b + T for _, b in cells])
    w, h = U1w - U0w, V1w - V0w
    mos = np.zeros((h, w, 3), np.uint8)
    for a, b in cells: mos[b - V0w:b - V0w + T, a - U0w:a - U0w + T] = np.asarray(Image.open(os.path.join(dst, shots[(a, b)])).convert('RGB'))
    mk = Wt.water_mask(U0w, V0w, w, h, 0, 0)
    mk = np.where(Wt.pier_mask(U0w, V0w, w, h, 0, 0) > 0, 0, mk).astype(np.uint8)    # piers/jetties stay as rendered
    if (mk > 0).sum() < 2000: continue                       # tiny ponds: leave them
    out = Wt.flatten(mos, mk)
    for a, b in cells:
        if (mk[b - V0w:b - V0w + T, a - U0w:a - U0w + T] > 0).any():
            fp = os.path.join(dst, shots[(a, b)]); os.remove(fp)              # break the hard link before writing
            Image.fromarray(out[b - V0w:b - V0w + T, a - U0w:a - U0w + T]).save(fp, compress_level=1)
    done += 1; print('cleaned', p['name'] or f"water #{p['i']}", len(cells), 'shots', flush=True)
print('water bodies cleaned:', done)
