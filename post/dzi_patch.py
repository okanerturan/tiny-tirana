"""Re-cut the Deep Zoom tiles over one box after the painting changed there (no full rebuild).

    python3 -I post/dzi_patch.py STORE TILES_DIR/name U0,V0,U1,V1 [--origin -40960,-69632]

STORE is the shaped store the tiles were built from (its t_ link to the merged painting, its m_ hold the coast). Levels
L and L-1 are cut from the store tiles touching the box (as post/dzi_store.py does); each coarser level is rebuilt from
its four children. Prints how many tiles were written; upload them with deploy/r2_upload.py --skip-existing.
"""
import math, os, sys, json
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dzi_store import do_store_tile, save, T, S


def main():
    store, dst = sys.argv[1], sys.argv[2]; u0, v0, u1, v1 = map(int, sys.argv[3].split(','))
    a = sys.argv; ox, oy = map(int, (a[a.index('--origin') + 1] if '--origin' in a else '-40960,-69632').split(','))
    meta = json.load(open(dst + '.json')); L = meta['maxLevel']; files = dst + '_files'; formats = meta['formats']
    n = 0
    for v in range(((v0 - oy) // S) * S + oy, v1, S):                       # levels L, L-1 from the store
        for u in range(((u0 - ox) // S) * S + ox, u1, S):
            if os.path.exists(os.path.join(store, f't_v{v}_u{u}.png')):
                do_store_tile((store, files, u, v, ox, oy, L, formats)); n += 20
    for lvl in range(L - 2, -1, -1):                                       # coarser levels from their children
        f = 2 ** (L - lvl); c0, r0 = (u0 - ox) // (T * f), (v0 - oy) // (T * f); c1, r1 = (u1 - ox) // (T * f), (v1 - oy) // (T * f)
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                im = Image.new('RGBA', (2 * T, 2 * T)); any_ = False
                for dy in (0, 1):
                    for dx in (0, 1):
                        p = os.path.join(files, str(lvl + 1), f'{2 * c + dx}_{2 * r + dy}.webp')
                        if os.path.exists(p): im.paste(Image.open(p).convert('RGBA'), (dx * T, dy * T)); any_ = True
                if not any_: continue
                save(im.resize((T, T), Image.LANCZOS), files, lvl, c, r, formats, False); n += 1
    print(f'patched ~{n} tiles over {u0},{v0}..{u1},{v1}')


if __name__ == '__main__':
    main()
