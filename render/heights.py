"""Height maps from render.js --height: decode, mosaic, lift pixels to 3D (ENU at the anchor), project into any heading."""
import glob, math, re
import numpy as np
from PIL import Image
import project as P

H0, H1 = -60.0, 260.0


def _range(path):
    import json, os
    f = os.path.join(os.path.dirname(os.path.abspath(path)), 'height_range.json')
    if os.path.exists(f):
        r = json.load(open(f)); return float(r['h0']), float(r['h1'])
    return H0, H1


def decode(path):
    a = np.asarray(Image.open(path).convert('RGB'), np.float64)
    v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h0, h1 = _range(path)
    h = h0 + (v - 1) / 16777214.0 * (h1 - h0)
    h[v == 0] = np.nan
    return h


def mosaic(d, u0, v0, size, S=2048):
    """Colour + height canvases for region [u0, u0+size) x [v0, v0+size) from shots in d."""
    col = np.zeros((size, size, 3), np.uint8); hgt = np.full((size, size), np.nan)
    for f in glob.glob(f'{d}/shot_v*_u*_height.png'):
        v, u = map(int, re.search(r'shot_v(-?\d+)_u(-?\d+)_height', f).groups())
        x0, y0 = u - u0, v - v0
        sx0, sy0, dx0, dy0 = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
        w, h = min(S - sx0, size - dx0), min(S - sy0, size - dy0)
        if w <= 0 or h <= 0: continue
        hgt[dy0:dy0 + h, dx0:dx0 + w] = decode(f)[sy0:sy0 + h, sx0:sx0 + w]
        col[dy0:dy0 + h, dx0:dx0 + w] = np.asarray(Image.open(f.replace('_height', '')).convert('RGB'))[sy0:sy0 + h, sx0:sx0 + w]
    return col, hgt


def frame(heading, c=P.CAM):
    h, t = math.radians(heading), math.radians(c['tilt'])
    F = np.array([math.sin(h) * math.cos(t), math.cos(h) * math.cos(t), -math.sin(t)])
    R = np.array([math.cos(h), -math.sin(h), 0.0]); U = np.cross(R, F)
    return F, R, U


def lift(u, v, hz, heading, mpp=P.CAM['mpp']):
    """Canvas px (u right, v down; anchor-relative) + world height -> ENU xyz."""
    F, R, U = frame(heading)
    xs, ys = u * mpp, -v * mpp
    tt = (hz - ys * U[2]) / F[2]
    return xs[..., None] * R + ys[..., None] * U + tt[..., None] * F


def to_canvas(p, heading, mpp=P.CAM['mpp']):
    F, R, U = frame(heading)
    return p @ R / mpp, -(p @ U) / mpp
