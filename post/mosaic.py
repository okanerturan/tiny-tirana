"""Stitch registered shots (shot_v{V}_u{U}.png) into one canvas. Usage: mosaic.py DIR OUT.png [U0,V0,U1,V1]"""
import sys, re, glob, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
d, out = sys.argv[1], sys.argv[2]
shots = {}
for f in glob.glob(os.path.join(d, 'shot_v*_u*.png')):
    v, u = map(int, re.search(r'shot_v(-?\d+)_u(-?\d+)\.png', f).groups()); shots[(u, v)] = f
S = Image.open(next(iter(shots.values()))).size[0]
U0 = min(u for u, _ in shots); V0 = min(v for _, v in shots)
U1 = max(u for u, _ in shots) + S; V1 = max(v for _, v in shots) + S
if len(sys.argv) > 3: U0, V0, U1, V1 = map(int, sys.argv[3].split(','))
c = Image.new('RGB', (U1 - U0, V1 - V0), (255, 0, 255))
for (u, v), f in shots.items(): c.paste(Image.open(f).convert('RGB'), (u - U0, v - V0))
c.save(out); print(out, c.size, 'origin', (U0, V0))
