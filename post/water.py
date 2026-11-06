"""OSM water in canvas pixels, and render clean-up so the painter can't read underwater shapes as land.

water_mask(x0, y0, w, h, U0, V0) -> uint8 mask (255 = water) for canvas window [x0, x0+w) x [y0, y0+h)
  where canvas px = camera px (u, v) - (U0, V0). Polygons are lakes, ponds and reservoirs (not rivers),
  projected at their own surface height, found by aligning each outline to the dark water in the render.
flatten(render_rgb, mask) -> render with calm, almost uniform water inside the mask (feathered edge).
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'render'))
import project as P

KINDS = {'lake', 'pond', 'reservoir', 'basin', 'water', None}
_polys = None


def polys():
    global _polys
    if _polys is None:
        W = json.load(open(os.path.join(HERE, '..', 'data', 'osm', 'water.json')))
        heights = json.load(open(os.path.join(HERE, '..', 'data', 'osm', 'water_heights.json'))) if os.path.exists(os.path.join(HERE, '..', 'data', 'osm', 'water_heights.json')) else {}
        _polys = []
        for i, o in enumerate(W):
            if o['kind'] not in KINDS or len(o['outer']) < 4:
                continue
            dh = heights.get(str(i), -2)
            h = P.CAM['groundH'] + dh
            _polys.append({'i': i, 'name': o['name'], 'outer': [P.to_px(la, lo, h) for la, lo in o['outer']],
                           'holes': [[P.to_px(la, lo, h) for la, lo in hole] for hole in o['holes']]})
    return _polys


def water_mask(x0, y0, w, h, U0, V0, scale=1):
    m = Image.new('L', (w // scale, h // scale)); d = ImageDraw.Draw(m)
    for p in polys():
        us = [u for u, _ in p['outer']]; vs = [v for _, v in p['outer']]
        if max(us) - U0 < x0 or min(us) - U0 > x0 + w or max(vs) - V0 < y0 or min(vs) - V0 > y0 + h:
            continue
        tr = lambda pts: [((u - U0 - x0) / scale, (v - V0 - y0) / scale) for u, v in pts]
        d.polygon(tr(p['outer']), fill=255)
        for hole in p['holes']:
            d.polygon(tr(hole), fill=0)
    return np.asarray(m)


_piers = None


def pier_mask(x0, y0, w, h, U0, V0, pad=14):
    """255 on OSM piers/jetties (deck + pillars + a little shadow): never flatten or repaint these."""
    global _piers
    if _piers is None:
        f = os.path.join(HERE, '..', 'data', 'osm', 'piers.json')
        _piers = json.load(open(f)) if os.path.exists(f) else []
    m = Image.new('L', (w, h)); d = ImageDraw.Draw(m)
    for o in _piers:
        h_deck = P.CAM['groundH'] - 1                       # a deck sits ~1 m above Tirana Lake's surface (groundH - 2)
        pts = [(u - U0 - x0, v - V0 - y0) for u, v in (P.to_px(la, lo, h_deck) for la, lo in o['pts'])]
        if max(x for x, _ in pts) < 0 or min(x for x, _ in pts) > w or max(y for _, y in pts) < 0 or min(y for _, y in pts) > h: continue
        if o.get('closed') and len(pts) >= 3: d.polygon(pts, fill=255)
        else: d.line(pts, fill=255, width=18)
    return np.asarray(m.filter(ImageFilter.MaxFilter(2 * pad + 1)))


def flatten(rgb, mask, erode=10, feather=14):
    """Replace water with its own heavily smoothed colour (kills reeds/sediment shapes, keeps a gentle gradient)."""
    a = np.asarray(rgb, np.float32); m = Image.fromarray(mask)
    core = np.asarray(m.filter(ImageFilter.MinFilter(2 * erode + 1)), np.float32) / 255
    if core.max() == 0:
        return np.asarray(rgb, np.uint8)
    # robust water colour: 30th percentile of the core (underwater weeds are lighter/greener than open water)
    px = a[core > 0.5]; base = np.percentile(px, 30, axis=0)
    small = Image.fromarray(np.where(core[..., None] > 0.5, a, base).astype(np.uint8)).reduce(16)
    smooth = np.asarray(small.filter(ImageFilter.GaussianBlur(24)).resize(rgb.shape[1::-1] if hasattr(rgb, 'shape') else rgb.size, Image.BILINEAR), np.float32)
    smooth = 0.75 * base + 0.25 * smooth                                 # mostly flat, a hint of gradient
    alpha = np.asarray(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(feather)), np.float32)[..., None] / 255
    rng = np.random.default_rng(0); noise = rng.normal(0, 2.0, a.shape[:2])[..., None]
    out = a * (1 - alpha) + (smooth + noise) * alpha
    return np.clip(out, 0, 255).astype(np.uint8)
