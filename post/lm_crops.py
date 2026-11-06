"""Cut the "on this map" view of every landmark card from a painted tile store.

    python3 -I post/lm_crops.py STORE viewer/app/lm [--preview OUT.jpg]

Centre: the landmark projected at half its height (between its `ground`, default GROUND, and its `top`), so tall buildings sit in the
middle of the frame. Window: 1240 x 921 camera px divided by the landmark's `zoom` (from landmarks.js),
resized to 1050 x 780 and written as {id}-map.webp and {id}-map.avif.
"""
import os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'render')); import project as P
sys.path.insert(0, HERE); from fill_blur import load

GROUND = P.GEO['ground']; OUT_W, OUT_H = 1050, 780; BASE_W = 1240


def landmarks():
    s = open(os.path.join(HERE, '..', 'viewer', 'app', 'landmarks.js')).read()
    for m in re.finditer(r"\{ id: '(\w+)', lat: ([\d.]+), lon: ([\d.]+), top: ([\d.]+),(?: ground: ([\d.]+),)? zoom: ([\d.]+)", s):
        id_, la, lo, top, gr, zoom = m.groups()
        yield id_, float(la), float(lo), float(top), float(gr) if gr else GROUND, float(zoom)


def main():
    store, out = sys.argv[1], sys.argv[2]; prev = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    thumbs = []
    for id_, lat, lon, top, ground, zoom in landmarks():
        u, v = P.to_px(lat, lon, (ground + top) / 2)
        for shrink in (1.0, 1.3, 1.7, 2.2):                             # at the painting's edge: a tighter window
            w = int(BASE_W / zoom / shrink); h = int(w * OUT_H / OUT_W); u0, v0 = int(u - w / 2), int(v - h / 2)
            a = load(store, u0, v0, u0 + w, v0 + h)
            if (a.max(2) == 0).mean() <= 0.01: break
        else:
            print(f'{id_}: crop not fully painted in {store}, skipped'); continue
        im = Image.fromarray(a).resize((OUT_W, OUT_H), Image.LANCZOS)
        if prev: thumbs.append(im.resize((OUT_W // 3, OUT_H // 3)))
        else:
            im.save(os.path.join(out, f'{id_}-map.webp'), quality=82, method=6)
            im.save(os.path.join(out, f'{id_}-map.avif'), quality=60)
        print(id_, (int(u), int(v)), w, 'x', h)
    if prev:
        g = Image.new('RGB', (OUT_W // 3 * 5, OUT_H // 3 * 2))
        for i, t in enumerate(thumbs): g.paste(t, ((i % 5) * (OUT_W // 3), (i // 5) * (OUT_H // 3)))
        g.save(prev); print('preview', prev)


if __name__ == '__main__':
    main()
