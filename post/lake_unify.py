"""Give a lake painted by two different runs one water colour (a block painted later can disagree on the tone).

    python3 -I post/lake_unify.py STORE U0,V0,U1,V1 [--backup DIR] [--dry OUT.jpg]

Inside the camera-px box: water = blue-dominant pixels (big connected areas only). The water splits into a DARK part
(luminance < DARK_LUM) and a LIGHT part. The light part is kept as painted; the dark part is repainted with the light
part's colours by distance to the shore (shore tone within ~150 px, deep tone beyond ~700 px, as the light half shows),
plus its own fine texture amplified a little, feathered at the shore and across the seam.
"""
import os, shutil, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); from fill_blur import load
T = 2048; DARK_LUM = 55


def main():
    st = sys.argv[1]; u0, v0, u1, v1 = map(int, sys.argv[2].split(',')); a = sys.argv
    bak = a[a.index('--backup') + 1] if '--backup' in a else None; dry = a[a.index('--dry') + 1] if '--dry' in a else None
    img = load(st, u0, v0, u1, v1).astype(np.float32); r, g, b = img[..., 0], img[..., 1], img[..., 2]
    lum = img.mean(2)
    water = (b > r + 12) & (b >= g - 8) & (lum < 170) & (img.max(2) > 0)
    water = ndimage.binary_opening(water, iterations=3); water = ndimage.binary_closing(water, iterations=6)
    lab, n = ndimage.label(water); sz = ndimage.sum(water, lab, range(1, n + 1))
    water = np.isin(lab, 1 + np.flatnonzero(sz > 200000)); water = ndimage.binary_fill_holes(water)
    dist = ndimage.distance_transform_edt(water)
    low_l = ndimage.gaussian_filter(lum, 12)
    dark = water & (low_l < DARK_LUM); light = water & ~dark & (dist > 20)
    if dark.sum() < 1000 or light.sum() < 1000: sys.exit(f'nothing to unify (dark {dark.sum()}, light {light.sum()})')
    sh = light & (dist < 150); dp = light & (dist > 700) if (light & (dist > 700)).sum() > 5000 else light & (dist > 350)
    c_sh, c_dp = np.median(img[sh], 0), np.median(img[dp], 0)
    w = np.clip((dist - 150) / 550, 0, 1)[..., None]; w = w * w * (3 - 2 * w)
    base = c_sh * (1 - w) + c_dp * w
    tex = img - np.stack([ndimage.gaussian_filter(img[..., c], 6) for c in range(3)], -1)
    out = base + tex * 1.6
    m = ndimage.gaussian_filter(dark.astype(np.float32), 18) * water           # feathered into the light half and the shore
    m = np.maximum(m, dark * 1.0)[..., None]
    res = np.clip(img * (1 - m) + out * m, 0, 255).astype(np.uint8)
    print(f'water {water.sum() / 1e6:.1f} Mpx, dark {dark.sum() / 1e6:.1f} Mpx repainted; shore {c_sh.round().tolist()} deep {c_dp.round().tolist()}')
    if dry:
        H, W = img.shape[:2]; Image.fromarray(np.concatenate([img.astype(np.uint8), res], 1)).resize((W // 4, H // 8)).save(dry); print('preview', dry); return
    if bak: os.makedirs(bak, exist_ok=True)
    for cv in range((v0 // T) * T, v1, T):
        for cu in range((u0 // T) * T, u1, T):
            t, mk = f'{st}/t_v{cv}_u{cu}.png', f'{st}/m_v{cv}_u{cu}.png'
            if not os.path.exists(mk): continue
            x0, y0, x1, y1 = max(u0, cu), max(v0, cv), min(u1, cu + T), min(v1, cv + T)
            if m[y0 - v0:y1 - v0, x0 - u0:x1 - u0].max() <= 0: continue
            if bak: shutil.copyfile(os.path.realpath(t), f'{bak}/t_v{cv}_u{cu}.png')
            ti = np.asarray(Image.open(os.path.realpath(t)).convert('RGB')).copy()
            ti[y0 - cv:y1 - cv, x0 - cu:x1 - cu] = res[y0 - v0:y1 - v0, x0 - u0:x1 - u0]
            if os.path.islink(t): os.remove(t)
            Image.fromarray(ti).save(t)
    print('applied')


if __name__ == '__main__':
    main()
