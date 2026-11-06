"""Paint an object out of a tile store by cloning the same surface from further along a direction (runways, pads,
roads: their texture runs along one axis, so a shifted copy keeps edges and stripes aligned).

    python3 -I post/clone_fill.py STORE U0 V0 U1 V1 DU DV [--feather 10] [--search 40] [--dark GREY] [--dry OUT.jpg]

[U0,U1) x [V0,V1) is the box to replace (camera px); (DU, DV) the shift to the source. The box is filled from the
source box with a feathered edge, so it melts into what is already there.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from fill_blur import load, save


def main():
    a = sys.argv[1:]; store = a[0]; U0, V0, U1, V1, DU, DV = map(int, a[1:7])
    fe = int(a[a.index('--feather') + 1]) if '--feather' in a else 10; dry = a[a.index('--dry') + 1] if '--dry' in a else None
    M = 3 * fe                                                       # context margin around the box
    dst = load(store, U0 - M, V0 - M, U1 + M, V1 + M).astype(np.float32)
    m = np.zeros(dst.shape[:2], np.float32); m[M:-M, M:-M] = 1
    # refine the shift: the source must continue the surface around the box, so match the context ring (search
    # +-R px around the given shift; coarse then fine)
    ring = m == 0; R = int(a[a.index('--search') + 1]) if '--search' in a else 40
    big = load(store, U0 - M + DU - R, V0 - M + DV - R, U1 + M + DU + R, V1 + M + DV + R).astype(np.float32)
    H, W = dst.shape[:2]; g = dst.mean(2); gb = big.mean(2)
    def cost(dx, dy): return np.abs(gb[R + dy:R + dy + H, R + dx:R + dx + W][ring] - g[ring]).mean()
    best = min(((cost(dx, dy), dx, dy) for dx in range(-R, R + 1, 4) for dy in range(-R, R + 1, 4)))
    best = min(((cost(dx, dy), dx, dy) for dx in range(max(-R, best[1] - 4), min(R, best[1] + 4) + 1) for dy in range(max(-R, best[2] - 4), min(R, best[2] + 4) + 1)))
    print(f'shift {DU + best[1]},{DV + best[2]} (given {DU},{DV}); ring mismatch {best[0]:.1f} grey levels')
    src = big[R + best[2]:R + best[2] + H, R + best[1]:R + best[1] + W]
    if '--dark' in a:                                                # replace only the dark object inside the box (grown a bit)
        th = float(a[a.index('--dark') + 1]); obj = (g < th) & (m > 0)
        obj = ndimage.binary_opening(obj, iterations=1); lab, n = ndimage.label(obj)
        if n: obj = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)              # the object itself, not shadows of trees
        obj = ndimage.binary_dilation(obj, iterations=fe)
        m = obj.astype(np.float32); print('dark object px:', int(obj.sum()))
    alpha = np.clip(ndimage.distance_transform_edt(m) / fe, 0, 1)[..., None]
    out = np.clip(dst * (1 - alpha) + src * alpha, 0, 255).astype(np.uint8)
    if dry:
        Image.fromarray(np.concatenate([dst.astype(np.uint8), out], 1)).save(dry, quality=92); print('preview', dry); return
    save(store, out, U0 - M, V0 - M, alpha[..., 0] > 0.001)


if __name__ == '__main__':
    main()
