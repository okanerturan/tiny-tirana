"""Even out a straight tone step across a block line on calm water (SDEdit healing keeps low frequencies, so a
slight colour difference between two blocks' water survives it; on flat water that reads as a line).

    python3 -I post/water_tone.py STORE H|V LINE A0 A1 [--dry OUT.jpg]

LINE is the block line (camera px: v for H, u for V); [A0, A1) the stretch along it. Within 384 px of the line, on
water only (OSM water mask), the low frequencies are rebuilt: fine texture from the original, broad tone from a
wide blur that ignores a +-64 px zone around the line. Shores and trees are untouched.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from fill_blur import load, save
import water as W

R, PROBE = 384, 24


def main():
    a = sys.argv[1:]; store, ax, c, a0, a1 = a[0], a[1], *map(int, a[2:5]); dry = a[a.index('--dry') + 1] if '--dry' in a else None
    u0, v0, u1, v1 = (a0, c - R, a1, c + R) if ax == 'H' else (c - R, a0, c + R, a1)
    img = load(store, u0, v0, u1, v1).astype(np.float32)
    wm = W.water_mask(u0, v0, u1 - u0, v1 - v0, 0, 0) > 127
    wm = ndimage.binary_erosion(wm, iterations=6)
    if ax == 'V': img, wm = img.transpose(1, 0, 2), wm.T                    # work as if the line were horizontal
    # rebuild the water's low frequencies near the line: fine texture (< ~16 px) from the original, broad tone from a
    # wide blur of the water that ignores a +-64 px zone around the line (so the step / stripe can't leak into it)
    y = np.arange(2 * R) + 0.5 - R
    src = wm & (np.abs(y)[:, None] > 64)
    def nblur(x, m, s):
        num = ndimage.gaussian_filter(x * m[..., None], (s, s, 0)); den = ndimage.gaussian_filter(m.astype(np.float32), s)[..., None]
        return num / np.maximum(den, 1e-4), den
    target, den = nblur(img, src, 96)
    fine = img - nblur(img, wm, 16)[0]
    # the step's own edge lives in `fine` too: near the line, borrow the texture from 64 px further out on the same side
    core = ndimage.binary_erosion(wm, iterations=24)                        # stay clear of shores and piers
    zi = np.nonzero(np.abs(y) < 32)[0]; si = np.where(y[zi] < 0, zi - 64, zi + 64)
    okb = core[zi] & core[si]
    fine[zi] = np.where(okb[..., None], fine[si], 0)                         # no borrowable texture: flat water there
    w = np.clip(1 - (np.abs(y) - 64) / (R - 64), 0, 1)[:, None, None] * (den > 0.05)
    feather = ndimage.gaussian_filter(core.astype(np.float32), 8)[..., None] * wm[..., None]
    t = np.arange(img.shape[1]) + 0.5; along = np.clip(np.minimum(t, img.shape[1] - t) / 128, 0, 1)   # fade in/out along the line
    alpha = w * feather * along[None, :, None]
    out = np.clip(img * (1 - alpha) + (target + fine) * alpha, 0, 255)
    def step(a):
        m = wm[R - PROBE:R - 2].all(0) & wm[R + 2:R + PROBE].all(0)
        return np.abs(a[R + 2:R + PROBE].mean(0) - a[R - PROBE:R - 2].mean(0)).sum(1)[m].mean() if m.any() else 0
    print('water step across the line: before %.1f, after %.1f (RGB L1)' % (step(img), step(out)))
    if ax == 'V': out, img, wm = out.transpose(1, 0, 2), img.transpose(1, 0, 2), wm.T
    if dry:
        Image.fromarray(np.concatenate([img, out], 0 if ax == 'H' else 1).astype(np.uint8)).save(dry, quality=92); print('preview', dry); return
    save(store, out.astype(np.uint8), u0, v0, wm)


if __name__ == '__main__':
    main()
