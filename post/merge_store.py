"""Merge a block-painting store (downloaded from Colab) into another store, filling only pixels that are unpainted there.

    python3 -I post/merge_store.py SRC_STORE DST_STORE [--backup DIR] [--only-new]

For every tile in SRC: if DST has no such tile it is copied; otherwise pixels where DST's mask is < 128 and SRC's mask is
>= 128 are taken from SRC (already painted pixels in DST, e.g. healed ones, are never touched). done_ markers are copied.
--backup saves every DST tile that gets changed first. Prints how many tiles were added and extended.
"""
import os, re, shutil, sys
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor


def main():
    src, dst = sys.argv[1], sys.argv[2]
    bak = sys.argv[sys.argv.index('--backup') + 1] if '--backup' in sys.argv else None
    if bak: os.makedirs(bak, exist_ok=True)
    os.makedirs(dst, exist_ok=True)
    tiles = [(m.group(1), m.group(2)) for f in os.listdir(src) if (m := re.match(r'm_v(-?\d+)_u(-?\d+)\.png$', f))]

    def one(t):
        v, u = t; name = f'v{v}_u{u}.png'
        sm = np.asarray(Image.open(f'{src}/m_{name}').convert('L'))
        if sm.max() < 128: return 'empty'
        dt, dm = f'{dst}/t_{name}', f'{dst}/m_{name}'
        if not os.path.exists(dm):
            shutil.copyfile(f'{src}/t_{name}', dt); shutil.copyfile(f'{src}/m_{name}', dm); return 'added'
        dmask = np.asarray(Image.open(dm).convert('L')).copy()
        take = (dmask < 128) & (sm >= 128)
        if not take.any(): return 'same'
        if bak:
            for k in ('t', 'm'): shutil.copyfile(f'{dst}/{k}_{name}', f'{bak}/{k}_{name}')
        timg = np.asarray(Image.open(os.path.realpath(dt)).convert('RGB')).copy()
        timg[take] = np.asarray(Image.open(f'{src}/t_{name}').convert('RGB'))[take]; dmask[take] = 255
        if os.path.islink(dt): os.remove(dt)
        Image.fromarray(timg).save(dt); Image.fromarray(dmask).save(dm); return 'extended'

    with ThreadPoolExecutor(8) as ex: res = list(ex.map(one, tiles))
    for f in os.listdir(src):
        if f.startswith('done_'): shutil.copyfile(f'{src}/{f}', f'{dst}/{f}')
    print({k: res.count(k) for k in ('added', 'extended', 'same', 'empty')}, 'of', len(tiles), 'tiles from', src)


if __name__ == '__main__':
    main()
