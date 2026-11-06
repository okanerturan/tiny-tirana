"""Prepare viewer/orbit8/: per heading a painted crop centred on the pivot + a median-smoothed height grid + meta.json.
    python3 -I post/orbit_prep.py OUT_DIR TAG:PAINT_PATTERN [TAG:PAINT_PATTERN ...]
PAINT_PATTERN uses {h}, e.g. v3b:data/rot/out8/v3b_h{h}.png ; 'render' is always added from data/rot/ctrl_h{h}.png.
"""
import json, os, sys
sys.path.insert(0, 'render')
import numpy as np
from PIL import Image, ImageFilter
import heights as Hm
import project as P

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
sources = dict(a.split(':', 1) for a in sys.argv[2:]); sources['render'] = 'data/rot/ctrl_h{h}.png'
d = json.load(open('data/rot_demo.json'))
PYR = (41.323019, 19.8215893); STEP = 4
piv = {h: (lambda uv: (uv[0] - u0, uv[1] - v0))(P.to_px(*PYR, c=dict(P.CAM, heading=float(h)))) for h, (u0, v0) in d.items()}
C = int(min(2 * min(px, py, 2048 - px - STEP, 2048 - py - STEP) for px, py in piv.values()) // 16 * 16)
N = C // STEP + 1
views = []
for h, (u0, v0) in d.items():
    px, py = piv[h]; x0, y0 = round(px - C / 2), round(py - C / 2)
    _, hg = Hm.mosaic(f'data/rot/hh{h}', u0 + x0, v0 + y0, C + STEP)
    hg = np.where(np.isfinite(hg), hg, np.nanmin(hg)).astype(np.float32)
    # 5x5 median on heights: calms the lumpy photogrammetry trees (spikes) without moving building edges much
    lo, hi = float(hg.min()), float(hg.max())
    q = Image.fromarray(np.round((hg - lo) / (hi - lo) * 65535).astype(np.uint16).astype(np.int32), mode='I').filter(ImageFilter.MedianFilter(5))
    hg = np.asarray(q, np.float32) / 65535 * (hi - lo) + lo
    hg[0:C + 1:STEP, 0:C + 1:STEP].astype('<f4').tofile(f'{out}/h{h}.f32')
    for tag, pat in sources.items():
        src = pat.format(h=h)
        im = Image.open(src).convert('RGB')
        if im.size != (2048, 2048): im = im.resize((2048, 2048), Image.LANCZOS)
        im.crop((x0, y0, x0 + C, y0 + C)).save(f'{out}/{tag}_h{h}.webp', quality=90, method=5)
    views.append({'heading': float(h), 'u0': u0 + x0, 'v0': v0 + y0})
json.dump({'size': C, 'step': STEP, 'n': N, 'mpp': P.CAM['mpp'], 'tilt': P.CAM['tilt'], 'views': views, 'models': list(sources)}, open(f'{out}/meta.json', 'w'), indent=1)
print('crop', C, 'views', [v['heading'] for v in views], 'models', list(sources))
