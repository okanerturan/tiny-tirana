"""Cut a big image into a Deep Zoom (DZI) pyramid for OpenSeadragon, in one or more formats, encoded in parallel.

    python3 -I post/dzi.py map.png OUT_DIR/map [--formats avif,webp] [--tile 512]
Writes OUT_DIR/map.dzi and OUT_DIR/map_files/<level>/<col>_<row>.<ext> for every format.

Quality: the deepest level (native pixels, what people see when zoomed in) keeps the texture of the pixel art;
lower levels are averaged overviews and are compressed harder. Measured on the Tirana map (24 random tiles):
  WebP q90: 70 KB, 36.0 dB | AVIF q75: 50 KB, 35.7 dB | WebP q88 m6: 61 KB, 35.5 dB | AVIF q60: 33 KB, 33.8 dB
"""
import argparse, math, os
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
Q = {  # (deepest level, lower levels)
    'avif': (dict(quality=75), dict(quality=60)),
    'webp': (dict(quality=88, method=6), dict(quality=78, method=6)),
}


def encode_row(job):
    path, level, row, w, h, T, O, formats, top, files = job
    img = Image.open(path)
    n = 0
    for col in range(math.ceil(w / T)):
        x0, y0 = col * T - (O if col else 0), row * T - (O if row else 0)
        x1, y1 = min(w, (col + 1) * T + O), min(h, (row + 1) * T + O)
        tile = img.crop((x0, y0, x1, y1))
        for fmt in formats:
            tile.save(os.path.join(files, str(level), f'{col}_{row}.{fmt}'), fmt.upper(), **Q[fmt][0 if top else 1])
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--tile', type=int, default=512)
    ap.add_argument('--overlap', type=int, default=1)
    ap.add_argument('--formats', default='avif,webp')
    ap.add_argument('--workers', type=int, default=os.cpu_count())
    a = ap.parse_args()
    formats = a.formats.split(',')
    img = Image.open(a.src).convert('RGB')
    W, H = img.size
    T, O = a.tile, a.overlap
    max_level = math.ceil(math.log2(max(W, H)))
    files = a.dst + '_files'
    tmp = a.dst + '_level.png'
    jobs, n = [], 0
    level_img = img
    with ProcessPoolExecutor(a.workers) as ex:
        for level in range(max_level, -1, -1):
            scale = 2 ** (max_level - level)
            w, h = max(1, math.ceil(W / scale)), max(1, math.ceil(H / scale))
            if level_img.size != (w, h):
                level_img = level_img.resize((w, h), Image.LANCZOS)
            os.makedirs(os.path.join(files, str(level)), exist_ok=True)
            lp = f'{tmp}.{level}.png'; level_img.save(lp, compress_level=1)
            jobs.append(lp)
            n += sum(ex.map(encode_row, [(lp, level, r, w, h, T, O, formats, level == max_level, files) for r in range(math.ceil(h / T))]))
    for lp in jobs:
        os.remove(lp)
    with open(a.dst + '.dzi', 'w') as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" '
                f'Format="{formats[0]}" Overlap="{O}" TileSize="{T}"><Size Width="{W}" Height="{H}"/></Image>\n')
    print(f'{a.dst}.dzi: {W}x{H}, {max_level + 1} levels, {n} tile files ({",".join(formats)})')


if __name__ == '__main__':
    main()
