"""Paint a big map block by block (tiny.london block mode) with ONE model load.

Blocks are S x S px, placed on a stride of S - overlap, painted in 4 checkerboard phases by (row, col) parity, so
blocks in the same phase never touch. Every block holds the pixels its earlier neighbours already painted fixed
(RePaint pinning, joint.py --known/--mask), so blocks grow out of each other instead of being stitched.

Input render shots: SHOTS/shot_v{v}_u{u}.png (2048 px, canvas px of their top-left). Output: a tile store in the
same 2048 grid, STORE/t_v{v}_u{u}.png + STORE/m_v{v}_u{u}.png (255 = painted). Resumable: STORE/done_{i}_{j}.

  python blocks.py --plan plan.json --shots DIR --store DIR --lora L [--only i,j;i,j] [--phase 0..3]
"""
import argparse, json, os, shutil, sys, time
from types import SimpleNamespace

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import joint as J

T = 2048


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def cells(u, v, S):
    """2048-grid cells overlapping [u, u+S) x [v, v+S), with the overlap rectangle in block and cell coords."""
    for cv in range((v // T) * T, v + S, T):
        for cu in range((u // T) * T, u + S, T):
            x0, y0, x1, y1 = max(u, cu), max(v, cv), min(u + S, cu + T), min(v + S, cv + T)
            if x0 < x1 and y0 < y1:
                yield cu, cv, (x0 - u, y0 - v, x1 - u, y1 - v), (x0 - cu, y0 - cv, x1 - cu, y1 - cv)


_index = {}


def shot_index(shots):
    """{(u, v): path} for every shot in the folder (png or jpg); shots may sit on any 1024 px grid."""
    if shots not in _index:
        import re
        d = {}
        for f in os.listdir(shots):
            m = re.match(r'shot_v(-?\d+)_u(-?\d+)\.(png|jpg)$', f)
            if m: d[(int(m.group(2)), int(m.group(1)))] = os.path.join(shots, f)
        _index[shots] = d
    return _index[shots]


def assemble(u, v, S, shots):
    """Block render from whatever 2048 px shots overlap it (blocks on an odd column use shots offset by 1024 px)."""
    idx = shot_index(shots)
    out = np.zeros((S, S, 3), np.uint8); filled = np.zeros((S, S), bool)
    for cv in range(((v - T + 1) // 1024) * 1024, v + S, 1024):
        for cu in range(((u - T + 1) // 1024) * 1024, u + S, 1024):
            f = idx.get((cu, cv))
            if not f: continue
            x0, y0, x1, y1 = max(u, cu), max(v, cv), min(u + S, cu + T), min(v + S, cv + T)
            if x0 >= x1 or y0 >= y1: continue
            sub = filled[y0 - v:y1 - v, x0 - u:x1 - u]
            if sub.all(): continue
            img = np.asarray(Image.open(f).convert('RGB'))[y0 - cv:y1 - cv, x0 - cu:x1 - cu]
            out[y0 - v:y1 - v, x0 - u:x1 - u][~sub] = img[~sub]; sub[:] = True
    if not filled.all():
        raise FileNotFoundError(f'block at u={u} v={v}: {100 * (1 - filled.mean()):.1f}% has no render shot')
    return out


def store_read(u, v, S, store):
    img = np.zeros((S, S, 3), np.uint8); msk = np.zeros((S, S), np.uint8)
    for cu, cv, (bx0, by0, bx1, by1), (sx0, sy0, sx1, sy1) in cells(u, v, S):
        t, m = os.path.join(store, f't_v{cv}_u{cu}.png'), os.path.join(store, f'm_v{cv}_u{cu}.png')
        if os.path.exists(m):
            img[by0:by1, bx0:bx1] = np.asarray(Image.open(t).convert('RGB'))[sy0:sy1, sx0:sx1]
            msk[by0:by1, bx0:bx1] = np.asarray(Image.open(m).convert('L'))[sy0:sy1, sx0:sx1]
    return img, msk


def store_write(u, v, S, store, painted, known_mask):
    """Write only pixels that were not already painted (pinned pixels stay as their first block drew them)."""
    for cu, cv, (bx0, by0, bx1, by1), (sx0, sy0, sx1, sy1) in cells(u, v, S):
        t, m = os.path.join(store, f't_v{cv}_u{cu}.png'), os.path.join(store, f'm_v{cv}_u{cu}.png')
        timg = np.asarray(Image.open(t).convert('RGB')).copy() if os.path.exists(t) else np.zeros((T, T, 3), np.uint8)
        tm = np.asarray(Image.open(m).convert('L')).copy() if os.path.exists(m) else np.zeros((T, T), np.uint8)
        new = known_mask[by0:by1, bx0:bx1] < 128
        region, rm = timg[sy0:sy1, sx0:sx1], tm[sy0:sy1, sx0:sx1]
        region[new] = painted[by0:by1, bx0:bx1][new]; rm[new] = 255
        Image.fromarray(timg).save(t + '.tmp.png', compress_level=1); os.replace(t + '.tmp.png', t)
        Image.fromarray(tm).save(m + '.tmp.png', compress_level=1); os.replace(m + '.tmp.png', m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True); ap.add_argument('--shots', required=True); ap.add_argument('--store', required=True)
    ap.add_argument('--lora', required=True); ap.add_argument('--work', default='/content/blockwork')
    ap.add_argument('--only', help='i,j;i,j  (subset of plan blocks)'); ap.add_argument('--phase', type=int)
    ap.add_argument('--batch', type=int, default=4); ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--lora_scale', type=float, default=1.0)
    ap.add_argument('--lattice', action='store_true', help='noise fixed to the map (joint.lattice_noise): overlapping blocks share it')
    ap.add_argument('--prep', default='none', help='render pre-filter before painting: none | blur (Gaussian 2.5 px, softer detail)')
    ap.add_argument('--aitk', default='/content/ai-toolkit')
    ap.add_argument('--model', default='Comfy-Org/Qwen-Image-2.1/diffusion_models/qwen_image_2.1_turbo_bf16.safetensors')
    a = ap.parse_args()
    plan = json.load(open(a.plan)); S = plan['S']
    os.makedirs(a.store, exist_ok=True); os.makedirs(a.work, exist_ok=True)
    blocks = plan['blocks']
    if a.only:
        want = {tuple(map(int, x.split(','))) for x in a.only.split(';')}
        blocks = [b for b in blocks if (b['i'], b['j']) in want]
    phases = [(0, 0), (0, 1), (1, 0), (1, 1)]
    order = [b for pj, pi in phases for b in blocks if (b['j'] % 2, b['i'] % 2) == (pj, pi)]
    if a.phase is not None:
        pj, pi = phases[a.phase]; order = [b for b in order if (b['j'] % 2, b['i'] % 2) == (pj, pi)]
    todo = [b for b in order if not os.path.exists(os.path.join(a.store, f"done_{b['i']}_{b['j']}"))]
    log(f'{len(order)} blocks in scope, {len(todo)} to paint, S={S}')
    if not todo:
        return
    m = J.load_model(SimpleNamespace(aitk=a.aitk, model=a.model, lora=a.lora, lora_scale=a.lora_scale))
    for n, b in enumerate(todo):
        t0 = time.time(); key = f"{b['i']}_{b['j']}"; wd = os.path.join(a.work, key)
        shutil.rmtree(wd, ignore_errors=True); os.makedirs(wd)
        ctrl = Image.fromarray(assemble(b['u'], b['v'], S, a.shots))
        if a.prep == 'blur':
            from PIL import ImageFilter
            ctrl = ctrl.filter(ImageFilter.GaussianBlur(2.5))
        ctrl.save(os.path.join(wd, 'ctrl.png'), compress_level=1)
        known, kmask = store_read(b['u'], b['v'], S, a.store)
        args = SimpleNamespace(region=None, seed=a.seed, batch=a.batch, prompt=J.CAPTION, known=None, mask=None,
                               decode_only=False, start_step=0, lora=a.lora,
                               origin=(b['u'] // J.VAE, b['v'] // J.VAE) if a.lattice else None)
        if kmask.max() > 0:
            Image.fromarray(known).save(os.path.join(wd, 'known.png'), compress_level=1)
            Image.fromarray(kmask).save(os.path.join(wd, 'mask.png'))
            args.known, args.mask = os.path.join(wd, 'known.png'), os.path.join(wd, 'mask.png')
        log(f'block {key} ({n + 1}/{len(todo)}) at u={b["u"]} v={b["v"]}, pinned {100 * (kmask > 127).mean():.0f}%')
        J.run_one(m, args, os.path.join(wd, 'ctrl.png'), wd)
        painted = np.asarray(Image.open(os.path.join(wd, 'map.png')).convert('RGB'))
        store_write(b['u'], b['v'], S, a.store, painted, kmask)
        open(os.path.join(a.store, f'done_{key}'), 'w').write(str(time.time()))
        shutil.rmtree(wd, ignore_errors=True)   # cond cache + latent checkpoints are large
        log(f'block {key} done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
