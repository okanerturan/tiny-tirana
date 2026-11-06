"""Automatic checks of a teacher drawing against its render (ground truth for structure), after tiny.london/Toronto.

- edge_corr: Pearson correlation of edge maps (render vs drawing) at 256 px. Low = the drawing does not follow the
  render (invented/moved/pasted content). Catches Qwen pasting the style tile into the square.
- flat_share: share of pixels whose 3x3 neighbourhood is (nearly) flat. Real redraws are flatter than photos;
  photo copies (Seedream, Qwen on the pyramid/lake) score low.
- block_edge_corr: worst edge_corr over a 4x4 grid of blocks that have structure: a local paste/invention in one
  region can hide behind a good global score.

    python3 -I qa.py RENDER.png DRAWING.png [...more pairs]      # prints metrics as JSON lines
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter


def gray(path, size):
    return np.asarray(Image.open(path).convert('L').resize((size, size), Image.BOX), np.float32)


def edges(a):
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]; gy[1:-1, :] = a[2:, :] - a[:-2, :]
    return np.hypot(gx, gy)


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d else 0.0


def flat_share(path, tol=6):
    a = np.asarray(Image.open(path).convert('RGB').resize((512, 512), Image.BOX), np.int16)
    mx = np.asarray(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.int16)
    mn = np.asarray(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.MinFilter(3)), np.int16)
    return float(((mx - mn).max(axis=2) <= tol).mean())


def metrics(render, drawing):
    er, ed = edges(gray(render, 256)), edges(gray(drawing, 256))
    blocks = []
    for i in range(4):
        for j in range(4):
            br, bd = er[i * 64:(i + 1) * 64, j * 64:(j + 1) * 64], ed[i * 64:(i + 1) * 64, j * 64:(j + 1) * 64]
            if br.std() > 4:  # only blocks with structure in the render
                blocks.append(corr(br, bd))
    return {'edge_corr': round(corr(er, ed), 3), 'block_edge_corr_min': round(min(blocks), 3) if blocks else None,
            'flat_share': round(flat_share(drawing), 3), 'render_flat_share': round(flat_share(render), 3)}


if __name__ == '__main__':
    a = sys.argv[1:]
    for r, d in zip(a[::2], a[1::2]):
        print(json.dumps({'drawing': d, **metrics(r, d)}))
