"""Deep Zoom pyramid straight from a block-painter tile store (no giant mosaic in memory).

The store (sampler/blocks.py) holds 2048 px tiles t_v{v}_u{u}.png (painted RGB) + m_v{v}_u{u}.png (255 = painted), in
CAMERA px on a 2048 grid. The canvas is the bounding box of the store's tiles (or --origin/--size). Unpainted pixels
become transparent. Tile size 512, overlap 0 (2048 is a multiple of 512, so the deepest two levels cut straight from
store tiles); every coarser level is cut from a quarter-resolution mosaic built on the way.

    python3 -I post/dzi_store.py STORE OUT_DIR/name [--formats avif,webp] [--origin U0,V0 --size W,H] [--workers 9]
Prints the canvas origin and size (for the app's CONFIG.canvasOrigin and map width/height).
"""
import argparse, json, math, os, re
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
T, S = 512, 2048
Q = {'avif': (dict(quality=75), dict(quality=60)), 'webp': (dict(quality=88, method=6), dict(quality=78, method=6))}


def save(img, files, level, col, row, formats, top):
    d = os.path.join(files, str(level)); os.makedirs(d, exist_ok=True)
    for f in formats:
        img.save(os.path.join(d, f'{col}_{row}.{f}'), f.upper(), **Q[f][0 if top else 1])


def rgba(store, u, v):
    t, m = os.path.join(store, f't_v{v}_u{u}.png'), os.path.join(store, f'm_v{v}_u{u}.png')
    if not os.path.exists(t): return None
    im = Image.open(t).convert('RGB')
    a = Image.open(m).convert('L') if os.path.exists(m) else Image.new('L', im.size, 255)
    im.putalpha(a); return im


def do_store_tile(job):
    """Deepest two levels for one 2048 store tile; returns its quarter-res image (bytes) for the mosaic."""
    store, files, u, v, U0, V0, L, formats = job
    im = rgba(store, u, v)
    if im is None: return u, v, None
    cx, cy = (u - U0) // T, (v - V0) // T
    for j in range(S // T):
        for i in range(S // T):
            tile = im.crop((i * T, j * T, (i + 1) * T, (j + 1) * T))
            if tile.getchannel('A').getextrema()[1] == 0: continue
            save(tile, files, L, cx + i, cy + j, formats, True)
    half = im.resize((S // 2, S // 2), Image.LANCZOS)
    for j in range(2):
        for i in range(2):
            tile = half.crop((i * T, j * T, (i + 1) * T, (j + 1) * T))
            if tile.getchannel('A').getextrema()[1] == 0: continue
            save(tile, files, L - 1, cx // 2 + i, cy // 2 + j, formats, False)
    q = im.resize((S // 4, S // 4), Image.LANCZOS)
    return u, v, q.tobytes()


def do_mosaic_row(job):
    path, files, level, row, formats = job
    m = Image.open(path); w, h = m.size; n = 0
    for col in range(math.ceil(w / T)):
        tile = m.crop((col * T, row * T, min(w, (col + 1) * T), min(h, (row + 1) * T)))
        if tile.getchannel('A').getextrema()[1] == 0: continue
        save(tile, files, level, col, row, formats, False); n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('store'); ap.add_argument('dst')
    ap.add_argument('--formats', default='avif,webp'); ap.add_argument('--origin'); ap.add_argument('--size')
    ap.add_argument('--workers', type=int, default=max(1, os.cpu_count() - 1))
    a = ap.parse_args(); formats = a.formats.split(',')
    tiles = []
    for f in os.listdir(a.store):
        mm = re.match(r't_v(-?\d+)_u(-?\d+)\.png$', f)
        if mm: tiles.append((int(mm.group(2)), int(mm.group(1))))
    if a.origin: U0, V0 = map(int, a.origin.split(','))
    else: U0, V0 = min(u for u, _ in tiles), min(v for _, v in tiles)
    if a.size: W, H = map(int, a.size.split(','))
    else: W, H = max(u for u, _ in tiles) + S - U0, max(v for _, v in tiles) + S - V0
    assert U0 % S == 0 and V0 % S == 0 and W % S == 0 and H % S == 0, 'canvas must align with the 2048 store grid'
    L = math.ceil(math.log2(max(W, H)))
    files = a.dst + '_files'; os.makedirs(files, exist_ok=True)
    print(f'canvas origin {U0},{V0} size {W}x{H}, {len(tiles)} store tiles, levels 0..{L}', flush=True)
    # deepest two levels + quarter-res mosaic
    quarter = Image.new('RGBA', (W // 4, H // 4), (0, 0, 0, 0))
    jobs = [(a.store, files, u, v, U0, V0, L, formats) for u, v in tiles]
    with ProcessPoolExecutor(a.workers) as ex:
        for k, (u, v, b) in enumerate(ex.map(do_store_tile, jobs, chunksize=2)):
            if b: quarter.paste(Image.frombytes('RGBA', (S // 4, S // 4), b), ((u - U0) // 4, (v - V0) // 4))
            if k % 200 == 0: print(f'  store tiles {k}/{len(jobs)}', flush=True)
    # coarser levels from the mosaic, halving each time
    level, img, tmp = L - 2, quarter, a.dst + '_tmp_level.png'
    while level >= 0:
        img.save(tmp, compress_level=1)
        rows = math.ceil(img.size[1] / T)
        with ProcessPoolExecutor(a.workers) as ex:
            list(ex.map(do_mosaic_row, [(tmp, files, level, r, formats) for r in range(rows)]))
        if level == 0: break
        img = img.resize((max(1, math.ceil(img.size[0] / 2)), max(1, math.ceil(img.size[1] / 2))), Image.LANCZOS); level -= 1
    os.remove(tmp)
    with open(a.dst + '.dzi', 'w') as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" TileSize="{T}" Overlap="0" '
                f'Format="{formats[0]}"><Size Width="{W}" Height="{H}"/></Image>\n')
    json.dump({'origin': [U0, V0], 'width': W, 'height': H, 'tileSize': T, 'overlap': 0, 'formats': formats, 'maxLevel': L},
              open(a.dst + '.json', 'w'))
    print(f'done: {a.dst}.dzi  origin {U0},{V0}  {W}x{H}', flush=True)


if __name__ == '__main__':
    main()
