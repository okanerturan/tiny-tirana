"""One small picture of the whole map, shown under the tiles so a view is never empty while its tiles download.

    python3 -I post/overview.py TILES_DIR/map viewer/app/overview [--level 11]

Stitches one Deep Zoom level (webp tiles; missing ones are transparent) into OUT.webp and OUT.avif at that level's size
(level 11 of the 108,544 px map is 1,696 x 1,568 px, 1/64 scale). Rerun after every tile rebuild.
"""
import json, math, os, sys, subprocess
from PIL import Image


def main():
    base, out = sys.argv[1], sys.argv[2]; a = sys.argv; lvl = int(a[a.index('--level') + 1]) if '--level' in a else 11
    dzi = open(base + '.dzi').read()
    W, H = (int(dzi.split(k + '="')[1].split('"')[0]) for k in ('Width', 'Height'))
    T = int(dzi.split('TileSize="')[1].split('"')[0])
    L = math.ceil(math.log2(max(W, H))); f = 2 ** (L - lvl); w, h = math.ceil(W / f), math.ceil(H / f)
    im = Image.new('RGBA', (w, h))
    for r in range(math.ceil(h / T)):
        for c in range(math.ceil(w / T)):
            p = f'{base}_files/{lvl}/{c}_{r}.webp'
            if os.path.exists(p): im.paste(Image.open(p).convert('RGBA'), (c * T, r * T))
    im.save(out + '.webp', quality=82, method=6)
    try:
        im.save(out + '.avif', quality=60)
    except Exception as e:
        print('no avif:', e)
    print(f'overview level {lvl}: {w}x{h}', {x: os.path.getsize(out + x) // 1024 for x in ('.webp', '.avif') if os.path.exists(out + x)}, 'KB')


if __name__ == '__main__':
    main()
