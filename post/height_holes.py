"""Report height-pass shots with missing data (tile fetch failures leave no-data pixels). Prints u,v of bad shots.
    python3 -I post/height_holes.py DIR [--max 0.5]   (percent of no-data pixels allowed)"""
import os, re, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
d = sys.argv[1]; lim = float(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 0.5
fs = [f for f in os.listdir(d) if f.endswith('_height.png')]
def holes(f):
    a = np.asarray(Image.open(os.path.join(d, f)).convert('RGB'))
    return f, 100.0 * float(((a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 0)).mean())
with ThreadPoolExecutor(8) as ex: res = list(ex.map(holes, fs))
bad = sorted([r for r in res if r[1] > lim], key=lambda r: -r[1])
print(f'{len(res)} shots, {len(bad)} with > {lim}% no-data', file=sys.stderr)
for f, p in bad:
    m = re.match(r'shot_v(-?\d+)_u(-?\d+)_height', f); print(f'{m.group(2)},{m.group(1)}  # {p:.1f}%')
