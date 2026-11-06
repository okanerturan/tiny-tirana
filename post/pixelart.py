"""Deep-zoom pixel-art layer (Isometric Toronto's method): 1 art pixel per FxF map pixels, one shared
256-colour palette for the whole map, light 4x4 ordered (Bayer) dither, nearest-neighbour upscale back.

    python3 -I pixelart.py map.png out.png [--factor 2] [--colors 256] [--dither 6] [--palette pal.png]
--palette reuses a saved palette so every patch/version of the map shares the same colours.
"""
import argparse
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16 - 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--factor', type=int, default=2)
    ap.add_argument('--colors', type=int, default=256)
    ap.add_argument('--dither', type=float, default=6.0, help='ordered dither amplitude in 0-255 levels')
    ap.add_argument('--palette', help='palette image to reuse (created next to dst if missing)')
    a = ap.parse_args()
    img = Image.open(a.src).convert('RGB')
    W, H = img.size
    small = img.resize((W // a.factor, H // a.factor), Image.BOX)
    pal_path = a.palette or a.dst.rsplit('.', 1)[0] + '_palette.png'
    try:
        pal = Image.open(pal_path); pal.load()
    except FileNotFoundError:
        # palette from a fixed-size sample of the whole map, median cut
        sample = small.resize((min(small.width, 2048), min(small.height, 2048)), Image.BOX)
        pal = sample.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        pal.save(pal_path)
    arr = np.asarray(small, np.float32)
    h, w = arr.shape[:2]
    bayer = np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w, None]
    arr = np.clip(arr + bayer * a.dither, 0, 255).astype(np.uint8)
    q = Image.fromarray(arr).quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB')
    q.resize((w * a.factor, h * a.factor), Image.NEAREST).save(a.dst)
    print(a.dst, q.size, 'palette', pal_path)


if __name__ == '__main__':
    main()
