"""Fill areas that Google's 3D data blurs on purpose (smeared, sharp-edged polygons) with neutral painted ground.

    python3 -I post/fill_blur.py STORE U0 V0 U1 V1 SU0 SV0 SU1 SV1 [--poly 'u,v;u,v;...'] [--grow PX] [--tone] [--kerb] [--dry OUT.jpg]

[U0,U1) x [V0,V1) is a camera-px box around one blurred site; the blurred polygon inside it is found by its
missing fine detail (convex hull of the low-detail cells). [SU0,SU1) x [SV0,SV1) is a painted source area
(forest, grass and trees) whose texture is quilted into the polygon with feathered patches. --tone matches the
fill's colour to the ring around the hole (good in woodland; leave it off where the ring is streets).
--dry writes a before/after preview instead of touching the store. Tiles are the store's 2048 t_ PNGs.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.spatial import ConvexHull

T = 2048


def load(store, u0, v0, u1, v1):
    a = np.zeros((v1 - v0, u1 - u0, 3), np.uint8)
    for v in range((v0 // T) * T, v1, T):
        for u in range((u0 // T) * T, u1, T):
            p = f'{store}/t_v{v}_u{u}.png'
            if not os.path.exists(p): continue
            t = np.asarray(Image.open(p).convert('RGB'))
            y0, x0 = max(v, v0), max(u, u0); y1, x1 = min(v + T, v1), min(u + T, u1)
            a[y0 - v0:y1 - v0, x0 - u0:x1 - u0] = t[y0 - v:y1 - v, x0 - u:x1 - u]
    return a


def save(store, a, u0, v0, mask):
    h, w = mask.shape
    for v in range((v0 // T) * T, v0 + h, T):
        for u in range((u0 // T) * T, u0 + w, T):
            y0, x0 = max(v, v0), max(u, u0); y1, x1 = min(v + T, v0 + h), min(u + T, u0 + w)
            if not mask[y0 - v0:y1 - v0, x0 - u0:x1 - u0].any(): continue
            p = f'{store}/t_v{v}_u{u}.png'
            t = np.asarray(Image.open(p).convert('RGB')).copy()
            t[y0 - v:y1 - v, x0 - u:x1 - u] = a[y0 - v0:y1 - v0, x0 - u0:x1 - u0]
            Image.fromarray(t).save(p, compress_level=1); print('wrote', os.path.basename(p))


def hole(a, cell=32, th=1.8):
    """Convex hull of the largest low-detail region, as a 0..1 float mask (hard edge)."""
    g = a.astype(np.float32).mean(2)
    hp = np.abs(g - ndimage.gaussian_filter(g, 2))
    e = ndimage.uniform_filter(hp, cell)
    low = (e < th) & (g > 25)                                  # not black/unpainted
    low = ndimage.binary_opening(low, iterations=6)
    lab, n = ndimage.label(low)
    if not n: raise SystemExit('no blurred area found')
    big = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    ys, xs = np.nonzero(big[::8, ::8]); pts = np.c_[xs, ys] * 8
    hull = pts[ConvexHull(pts).vertices]
    m = Image.new('L', (a.shape[1], a.shape[0])); ImageDraw.Draw(m).polygon([tuple(p) for p in hull], fill=255)
    m = m.filter(ImageFilter.MaxFilter(25))                    # take the smeared rim too
    return np.asarray(m, np.float32) / 255, hull


def quilt(src, h, w, P=448, S=320, seed=0):
    """Cover h x w with feathered P-px patches drawn at random from src (stride S)."""
    rng = np.random.default_rng(seed); out = np.zeros((h, w, 3), np.float32); wt = np.zeros((h, w, 1), np.float32)
    r = np.minimum(np.arange(P) + 1, P - np.arange(P)).astype(np.float32); win = np.minimum.outer(r, r)[..., None] / (P / 2)
    for y in range(-S // 2, h, S):
        for x in range(-S // 2, w, S):
            sy = rng.integers(0, src.shape[0] - P); sx = rng.integers(0, src.shape[1] - P)
            ya, xa = max(y, 0), max(x, 0); yb, xb = min(y + P, h), min(x + P, w)
            if ya >= yb or xa >= xb: continue
            pt = src[sy + ya - y:sy + yb - y, sx + xa - x:sx + xb - x].astype(np.float32); ww = win[ya - y:yb - y, xa - x:xb - x]
            out[ya:yb, xa:xb] += pt * ww; wt[ya:yb, xa:xb] += ww
    return out / np.maximum(wt, 1e-6)


def main():
    a = sys.argv[1:]; store = a[0]; U0, V0, U1, V1, SU0, SV0, SU1, SV1 = map(int, a[1:9])
    tone = '--tone' in a; dry = a[a.index('--dry') + 1] if '--dry' in a else None
    img = load(store, U0, V0, U1, V1); src = load(store, SU0, SV0, SU1, SV1)
    if '--poly' in a:                                          # explicit polygon "u,v;u,v;..." in camera px
        pts = [tuple(map(float, q.split(','))) for q in a[a.index('--poly') + 1].split(';')]
        hull = [(u - U0, v - V0) for u, v in pts]
        mm = Image.new('L', (img.shape[1], img.shape[0])); ImageDraw.Draw(mm).polygon(hull, fill=255)
        m = np.asarray(mm.filter(ImageFilter.MaxFilter(int(a[a.index('--grow') + 1]) if '--grow' in a else 25)), np.float32) / 255
    else:
        m, hull = hole(img)
    print('hull (camera px):', [(int(x) + U0, int(y) + V0) for x, y in hull])
    fill = quilt(src, *img.shape[:2])
    if tone:                                                   # match colour stats to the ring outside the hole
        ring = (ndimage.binary_dilation(m > 0.5, iterations=60) & (m < 0.01))
        mu_r, sd_r = img[ring].mean(0), img[ring].std(0); mu_s, sd_s = src.reshape(-1, 3).mean(0), src.reshape(-1, 3).std(0)
        fill = (fill - mu_s) * np.clip(sd_r / sd_s, 0.8, 1.25) + mu_r
    alpha = ndimage.gaussian_filter(m, 8)[..., None] * (m[..., None] > 0) + 0 * m[..., None]
    alpha = np.maximum(alpha, ndimage.binary_erosion(m > 0.5, iterations=16)[..., None].astype(np.float32))
    out = np.clip(img * (1 - alpha) + fill * alpha, 0, 255)
    if '--kerb' in a:                                          # a thin pale wall/kerb on the polygon edge (urban compounds)
        inner = m > 0.5; band = inner & ~ndimage.binary_erosion(inner, iterations=7)
        k = ndimage.gaussian_filter(band.astype(np.float32), 1.2)[..., None]
        ring = (ndimage.binary_dilation(m > 0.5, iterations=30) & (m < 0.01))
        col = np.percentile(img[ring], 70, axis=0)
        out = out * (1 - 0.8 * k) + col * 0.8 * k
    out = out.astype(np.uint8)
    if dry:
        s = max(1, max(img.shape[:2]) // 1400)
        pv = np.concatenate([img[::s, ::s], out[::s, ::s]], 1); Image.fromarray(pv).save(dry); print('preview', dry); return
    save(store, out, U0, V0, alpha[..., 0] > 0.002)


if __name__ == '__main__':
    main()
