"""Joint (seamless) sampling of a whole map canvas with Qwen-Image-2.1-Turbo + a tiranaiso LoRA.

Method: tiny.london / Isometric Toronto. One latent for the whole canvas. Every step runs the model on
overlapping 1024 px windows (768 px stride; odd steps use a grid shifted by 384 px), averages the
velocity predictions with tent weights (0 at the window edge, flat in the middle 512 px), and takes one
Euler step for the whole canvas. Optional RePaint pinning keeps already-finished pixels fixed.

Each window is conditioned exactly like the LoRA was trained (ai-toolkit qwen_image_2, edit mode): the
window's 1024 px render crop rides in the prompt as vision tokens AND in the sequence as clean latents.

Runs on a Colab G4 with ai-toolkit (commit e9c72b7) importable. Resumable: the latent is checkpointed
after every step.

  python joint.py --control canvas.png --lora s1000.safetensors --out /content/run1 [--region x0,y0,x1,y1]
"""
import argparse, re, json, math, os, sys, time

import numpy as np
import torch
from PIL import Image
from safetensors.torch import load_file

Image.MAX_IMAGE_PIXELS = None
CAPTION = ("tiranaiso, convert this Google 3D isometric render of Tirana into the tiranaiso illustrated "
           "isometric pixel-art map style, keep geometry exact")
VAE = 16          # pixels per latent cell
WIN = 1024 // VAE  # 64 latent cells per window
STRIDE = 768 // VAE
SHIFT = 384 // VAE
RAMP = 256 // VAE  # tent ramp each side; flat middle = 512 px


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def positions(n, win, stride, offset=0):
    """Window starts covering [0, n) with the given stride; always includes both ends."""
    if n <= win:
        return [0]
    ps = list(range(offset, n - win + 1, stride))
    if offset:
        ps = [0] + ps
    if ps[-1] != n - win:
        ps.append(n - win)
    return sorted(set(ps))


def tent(win, ramp, at_top, at_bottom, at_left, at_right):
    """(win, win) weight: linear ramp 0->1 over `ramp` cells at window edges, but flat at canvas borders."""
    r = torch.ones(win)
    ramp_up = (torch.arange(ramp) + 0.5) / ramp
    def edge(lo_border, hi_border):
        w = r.clone()
        if not lo_border:
            w[:ramp] = ramp_up
        if not hi_border:
            w[-ramp:] = ramp_up.flip(0)
        return w
    return edge(at_top, at_bottom)[:, None] * edge(at_left, at_right)[None, :]


LATTICE = 64                                       # latent cells per noise tile (1024 px)


def lattice_noise(C, Hl, Wl, y0, x0, seed):
    """Gaussian noise for a latent window whose top-left cell is (y0, x0) in ABSOLUTE map latent cells (camera px / 16).
    Each 64 x 64 tile of the map has its own seeded generator, so any two blocks that overlap see exactly the same noise
    there. With RePaint pinning that matters at the high-noise steps where the layout is decided: the pinned border is
    noised with the very noise that painted it, so the new block grows out of the same field instead of an unrelated one."""
    out = torch.empty((1, C, Hl, Wl), dtype=torch.float32)
    for ty in range(y0 // LATTICE, (y0 + Hl - 1) // LATTICE + 1):
        for tx in range(x0 // LATTICE, (x0 + Wl - 1) // LATTICE + 1):
            g = torch.Generator('cpu').manual_seed((seed * 1000003 + (ty + 100000) * 200003 + (tx + 100000)) % (2 ** 63 - 1))
            tile = torch.randn((C, LATTICE, LATTICE), generator=g, dtype=torch.float32)
            ya, xa = max(y0, ty * LATTICE), max(x0, tx * LATTICE); yb, xb = min(y0 + Hl, (ty + 1) * LATTICE), min(x0 + Wl, (tx + 1) * LATTICE)
            out[0, :, ya - y0:yb - y0, xa - x0:xb - x0] = tile[:, ya - ty * LATTICE:yb - ty * LATTICE, xa - tx * LATTICE:xb - tx * LATTICE]
    return out


def encode_big(m, img_chw, dev, dt):
    """VAE-encode an image of any size: the VAE's own tiled encode (1024 px tiles, 768 stride, blended)."""
    m.vae.to(dev)
    m.vae.enable_tiling(tile_sample_min_height=1024, tile_sample_min_width=1024, tile_sample_stride_height=768, tile_sample_stride_width=768)
    try:
        return m.encode_images([img_chw.to(dev) * 2 - 1], device=dev, dtype=dt).float().cpu()
    finally:
        m.vae.disable_tiling()


def merge_lora(transformer, path, scale=1.0):
    sd = load_file(path)
    mods = dict(transformer.named_modules())
    n = 0
    for k in [k for k in sd if k.endswith('lora_A.weight')]:
        base = k[:-len('.lora_A.weight')].replace('diffusion_model.', '', 1)
        A, B = sd[k].float(), sd[k.replace('lora_A', 'lora_B')].float()
        alpha = sd.get(k.replace('lora_A.weight', 'alpha'))
        s = scale * (float(alpha) / A.shape[0] if alpha is not None else 1.0)
        m = mods[base]
        w = m.weight
        w.data = (w.data.float() + s * (B @ A).to(w.device)).to(w.dtype)
        n += 1
    log(f'merged LoRA {os.path.basename(path)}: {n} modules')


def load_model(args):
    sys.path.insert(0, args.aitk)
    from toolkit.config_modules import ModelConfig
    from extensions_built_in.diffusion_models.qwen_image_2.qwen_image_2 import QwenImage2Model
    cfg = ModelConfig(arch='qwen_image_2', name_or_path=args.model, quantize=False, quantize_te=False,
                      dtype='bf16', vae_dtype='bf16', model_kwargs={'turbo': True, 'rgba': False})
    m = QwenImage2Model(device='cuda:0', model_config=cfg, dtype='bf16')
    m.load_model()
    for p in m.transformer.parameters():
        p.requires_grad_(False)
    merge_lora(m.transformer, args.lora, args.lora_scale)
    return m


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', help='registered render canvas (PNG)')
    ap.add_argument('--region', help='x0,y0,x1,y1 in canvas px (multiples of 16); default whole canvas')
    ap.add_argument('--lora', required=True)
    ap.add_argument('--lora_scale', type=float, default=1.0)
    ap.add_argument('--out')
    ap.add_argument('--jobs', help='several canvases with one model load: CONTROL=OUT,CONTROL=OUT,...')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--batch', type=int, default=4)
    ap.add_argument('--prompt', default=CAPTION)
    ap.add_argument('--known', help='finished image (same size as region) to pin, with --mask (white = keep)')
    ap.add_argument('--mask')
    ap.add_argument('--aitk', default='/content/ai-toolkit')
    ap.add_argument('--model', default='Comfy-Org/Qwen-Image-2.1/diffusion_models/qwen_image_2.1_turbo_bf16.safetensors')
    ap.add_argument('--decode_only', action='store_true')
    ap.add_argument('--start_step', type=int, default=0,
                    help='img2img: start at this turbo step from the noised render latent instead of pure noise '
                         '(e.g. 5 -> sigma 0.845, 6 -> 0.705); keeps more of the render\'s texture/colour. Regions <= 4096 px.')
    ap.add_argument('--heal', action='store_true',
                    help='seam healing: for each job X_ctrl.*, start from X_paint.png (noised to --start_step) and pin it '
                         'with the SOFT mask X_mask.png (255 = keep exactly, 0 = repaint, in between = blend each step)')
    args = ap.parse_args()
    jobs = [j.split('=', 1) for j in args.jobs.split(',')] if args.jobs else [(args.control, args.out)]
    assert all(c and o for c, o in jobs), 'need --control/--out or --jobs'
    m = load_model(args)
    for control, out in jobs:
        log(f'=== job {control} -> {out}')
        run_one(m, args, control, out)


@torch.no_grad()
def run_one(m, args, control, out):
    os.makedirs(out, exist_ok=True)

    ctrl = Image.open(control).convert('RGB')
    if args.region:
        x0, y0, x1, y1 = map(int, args.region.split(','))
        ctrl = ctrl.crop((x0, y0, x1, y1))
    W, H = ctrl.size
    assert W % VAE == 0 and H % VAE == 0 and W >= 1024 and H >= 1024, (W, H)
    Hl, Wl = H // VAE, W // VAE
    json.dump(vars(args) | {'W': W, 'H': H}, open(os.path.join(out, 'run.json'), 'w'), indent=1)

    from extensions_built_in.diffusion_models.qwen_image_2.src.pipeline import (
        run_transformer, TURBO_SAMPLE_SIGMAS)
    dev, dt = m.device_torch, m.torch_dtype
    sigmas = list(TURBO_SAMPLE_SIGMAS) + [0.0]

    ys_a, xs_a = positions(Hl, WIN, STRIDE), positions(Wl, WIN, STRIDE)
    ys_b, xs_b = positions(Hl, WIN, STRIDE, SHIFT), positions(Wl, WIN, STRIDE, SHIFT)
    grids = [[(y, x) for y in ys_a for x in xs_a], [(y, x) for y in ys_b for x in xs_b]]
    allw = sorted(set(grids[0]) | set(grids[1]))
    log(f'canvas {W}x{H} px, latent {Wl}x{Hl}; windows grid A {len(grids[0])}, grid B {len(grids[1])}, unique {len(allw)}')

    ckpt = os.path.join(out, 'latent.pt')
    state = torch.load(ckpt) if os.path.exists(ckpt) else None

    if not args.decode_only and (state is None or state['step'] < len(sigmas) - 1):
        # --- per-window conditioning, computed once (TE + VAE), kept on CPU ---
        cache_f = os.path.join(out, 'cond_cache.pt')
        if os.path.exists(cache_f):
            cond = torch.load(cache_f)
            log(f'loaded conditioning cache ({len(cond)} windows)')
        else:
            cond = {}
            t0 = time.time()
            arr = np.asarray(ctrl, dtype=np.float32) / 255.0
            for i, (y, x) in enumerate(allw):
                crop = torch.from_numpy(arr[y * VAE:(y + WIN) * VAE, x * VAE:(x + WIN) * VAE]).permute(2, 0, 1)[None]
                ref = m._prepare_control_images([[crop]], target_pixels=1024 * 1024)
                pe = m.get_prompt_embeds(args.prompt, control_images=[[crop]], target_size=(1024, 1024))
                emb, msk, slot = m.pad_prompt_embeds(pe)
                lat, shapes = m.encode_condition_images(ref)
                cond[(y, x)] = (emb[0].cpu(), msk[0].cpu(), slot[0].cpu(), lat[0].cpu(), shapes)
                if i % 50 == 0:
                    log(f'cond {i + 1}/{len(allw)} ({time.time() - t0:.0f}s) tokens={emb.shape[1]}')
            torch.save(cond, cache_f)
        m.text_encoder[0].to('cpu'); torch.cuda.empty_cache()

        C = m.transformer.config.in_channels
        if getattr(args, 'origin', None) is not None:          # block mode: noise fixed to the map, shared by overlapping blocks
            noise = lattice_noise(C, Hl, Wl, args.origin[1], args.origin[0], args.seed)
        else:
            g = torch.Generator('cpu').manual_seed(args.seed)
            noise = torch.randn((1, C, Hl, Wl), generator=g, dtype=torch.float32)
        heal = re.sub(r'_ctrl\.\w+$', '', control) if getattr(args, 'heal', False) else None
        if heal:
            assert args.start_step > 0, '--heal needs --start_step'
            paint_p = next(heal + e for e in ('_paint.png', '_paint.jpg') if os.path.exists(heal + e))
        if state is None and args.start_step > 0:
            src = Image.open(paint_p).convert('RGB') if heal else ctrl
            assert src.size == ctrl.size, (src.size, ctrl.size)
            r = torch.from_numpy(np.asarray(src, dtype=np.float32) / 255.0).permute(2, 0, 1)
            x0 = encode_big(m, r, dev, dt)
            step = args.start_step
            latents = (1 - sigmas[step]) * x0 + sigmas[step] * noise
            log(f'img2img: starting at step {step} (sigma {sigmas[step]:.3f}) from the {"painting" if heal else "render"} latent')
        elif state is None:
            latents, step = noise.clone(), 0
        else:
            latents, step = state['latents'], state['step']
            log(f'resuming at step {step}')
        known = mask = None
        if heal:                                                   # soft pin: keep the strip edges, blend toward the centre
            known = x0 if state is None and args.start_step > 0 else encode_big(m, torch.from_numpy(np.asarray(
                Image.open(paint_p).convert('RGB'), dtype=np.float32) / 255.0).permute(2, 0, 1), dev, dt)
            mk = Image.open(heal + '_mask.png').convert('L').resize((Wl, Hl), Image.BOX)
            mask = torch.from_numpy(np.asarray(mk, dtype=np.float32) / 255.0)[None, None]
        elif args.known:
            kim = torch.from_numpy(np.asarray(Image.open(args.known).convert('RGB'), dtype=np.float32) / 255.0)
            known = encode_big(m, kim.permute(2, 0, 1), dev, dt)
            mk = Image.open(args.mask).convert('L').resize((Wl, Hl), Image.BOX)
            mask = (torch.from_numpy(np.asarray(mk, dtype=np.float32) / 255.0) > 0.5).float()[None, None]

        weights = {}
        for (y, x) in allw:
            weights[(y, x)] = tent(WIN, RAMP, y == 0, y + WIN == Hl, x == 0, x + WIN == Wl)

        while step < len(sigmas) - 1:
            t0 = time.time()
            s, s_next = sigmas[step], sigmas[step + 1]
            vel = torch.zeros_like(latents); wsum = torch.zeros((1, 1, Hl, Wl))
            grid = grids[step % 2]
            for b in range(0, len(grid), args.batch):
                chunk = grid[b:b + args.batch]
                x_in = torch.cat([latents[:, :, y:y + WIN, x:x + WIN] for y, x in chunk]).to(dev, dt)
                c = [cond[w] for w in chunk]
                emb = torch.stack([e[0] for e in c]).to(dev, dt)
                msk = torch.stack([e[1] for e in c]).to(dev)
                slot = torch.stack([e[2] for e in c]).to(dev)
                lat = torch.stack([e[3] for e in c]).to(dev, dt)
                tt = torch.full((len(chunk),), s, device=dev, dtype=dt)
                v = run_transformer(m.transformer, x_in, tt, emb, msk, slot,
                                    condition_latents=lat, condition_shapes=c[0][4]).float().cpu()
                for j, (y, x) in enumerate(chunk):
                    wt = weights[(y, x)]
                    vel[:, :, y:y + WIN, x:x + WIN] += v[j:j + 1] * wt
                    wsum[:, :, y:y + WIN, x:x + WIN] += wt
            latents = latents + (s_next - s) * vel / wsum
            if known is not None:
                pinned = (1 - s_next) * known + s_next * noise
                latents = mask * pinned + (1 - mask) * latents
            step += 1
            torch.save({'latents': latents, 'step': step}, ckpt + '.tmp'); os.replace(ckpt + '.tmp', ckpt)
            log(f'step {step}/{len(sigmas) - 1} sigma {s:.3f}->{s_next:.3f} windows {len(grid)} {time.time() - t0:.0f}s')
        state = {'latents': latents, 'step': step}

    # --- decode: overlapping latent regions, VAE tiling inside, linear blend between regions ---
    latents = state['latents']
    m.vae.to(dev)
    R, OV = 128, 16  # 2048 px regions, 256 px overlap
    canvas = np.zeros((H, W, 3), np.float32); acc = np.zeros((H, W, 1), np.float32)
    ys = positions(Hl, R, R - OV) if Hl > R else [0]
    xs = positions(Wl, R, R - OV) if Wl > R else [0]
    for y in ys:
        for x in xs:
            h, w = min(R, Hl - y), min(R, Wl - x)
            img = m.decode_latents(latents[:, :, y:y + h, x:x + w].to(dev, dt))  # (1,3,H,W) in [-1,1]
            img = ((img[0].float().clamp(-1, 1) + 1) / 2).permute(1, 2, 0).cpu().numpy()
            wt = tent(max(h, w), OV, y == 0, y + h == Hl, x == 0, x + w == Wl)[:h, :w]
            wt = torch.nn.functional.interpolate(wt[None, None], size=(h * VAE, w * VAE), mode='bilinear')[0, 0, :, :, None].numpy()
            canvas[y * VAE:(y + h) * VAE, x * VAE:(x + w) * VAE] += img * wt
            acc[y * VAE:(y + h) * VAE, x * VAE:(x + w) * VAE] += wt
    img = Image.fromarray((canvas / np.maximum(acc, 1e-6) * 255).round().clip(0, 255).astype(np.uint8))
    img.save(os.path.join(out, 'map.png'))
    img.resize((W // 4, H // 4), Image.LANCZOS).save(os.path.join(out, 'map_preview.jpg'), quality=88)
    log('saved map.png', img.size)


if __name__ == '__main__':
    main()
