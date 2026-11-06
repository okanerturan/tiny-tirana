"""Blend healed seam strips (joint.py --heal output) back into a tile store.

    python3 -I post/heal_apply.py STORE STRIPS_DIR RESULTS_DIR [--backup DIR] [--preview OUT_DIR]

STRIPS_DIR holds strips.json ({name: [u, v, w, h]}) and each {name}_mask.png from heal_prep.py; RESULTS_DIR holds
{name}.jpg. Each result is blended with alpha = 1 - mask (the same soft mask that pinned it), so kept edges stay
exactly as they were. With --preview, writes before/after JPEGs of each strip's middle instead of touching the store.
"""
import argparse, json, os, shutil, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from fill_blur import load, save

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('store'); ap.add_argument('strips'); ap.add_argument('results')
    ap.add_argument('--backup'); ap.add_argument('--preview'); a = ap.parse_args()
    S = json.load(open(os.path.join(a.strips, 'strips.json')))
    for name, (u, v, w, h) in S.items():
        r = os.path.join(a.results, name + '.jpg')
        if not os.path.exists(r): print('missing result', name); continue
        new = np.asarray(Image.open(r).convert('RGB'), np.float32)
        assert new.shape[:2] == (h, w), (name, new.shape, w, h)
        keep = np.asarray(Image.open(os.path.join(a.strips, name + '_mask.png')), np.float32)[..., None] / 255
        old = load(a.store, u, v, u + w, v + h).astype(np.float32)
        out = np.clip(old * keep + new * (1 - keep), 0, 255).astype(np.uint8)
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            L = max(w, h); c0 = L // 2 - 1024; c1 = c0 + 2048
            sl = (slice(c0, c1), slice(None)) if h > w else (slice(None), slice(c0, c1))
            Image.fromarray(np.concatenate([old[sl].astype(np.uint8), out[sl]], 1 if h > w else 0)).save(os.path.join(a.preview, name + '.jpg'), quality=90)
            print('preview', name); continue
        if a.backup:
            os.makedirs(a.backup, exist_ok=True); T = 2048
            for tv in range((v // T) * T, v + h, T):
                for tu in range((u // T) * T, u + w, T):
                    f = f't_v{tv}_u{tu}.png'
                    if os.path.exists(os.path.join(a.store, f)) and not os.path.exists(os.path.join(a.backup, f)):
                        shutil.copy2(os.path.join(a.store, f), os.path.join(a.backup, f))
        save(a.store, out, u, v, keep[..., 0] < 0.999)
        print('applied', name)


if __name__ == '__main__':
    main()
