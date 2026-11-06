"""Write which Deep Zoom tiles exist, so the viewer never asks for the empty ones (dzi_store.py skips fully
transparent tiles, and a request for one would be a 404).

    python3 -I post/tile_index.py viewer/tiles_city/map [FORMAT]      # -> viewer/tiles_city/map_index.json

The index is {"levels": {level: [cols, rows, base64 bitset]}}; bit (row * cols + col) is set when the tile exists,
least significant bit first in each byte.
"""
import base64, json, math, os, re, sys

base = sys.argv[1]; fmt = sys.argv[2] if len(sys.argv) > 2 else 'webp'
meta = json.load(open(base + '.json')); W, H, T = meta['width'], meta['height'], meta['tileSize']
maxL = math.ceil(math.log2(max(W, H))); out = {}
for L in sorted(int(d) for d in os.listdir(base + '_files') if d.isdigit()):
    s = 2 ** (maxL - L); cols, rows = math.ceil(math.ceil(W / s) / T), math.ceil(math.ceil(H / s) / T)
    bits = bytearray((cols * rows + 7) // 8); n = 0
    for f in os.listdir(f'{base}_files/{L}'):
        m = re.match(rf'(\d+)_(\d+)\.{fmt}$', f)
        if not m: continue
        c, r = int(m.group(1)), int(m.group(2)); i = r * cols + c; bits[i >> 3] |= 1 << (i & 7); n += 1
    out[L] = [cols, rows, base64.b64encode(bytes(bits)).decode()]
    print(f'level {L}: {n}/{cols * rows}')
json.dump({'levels': out}, open(base + '_index.json', 'w'), separators=(',', ':'))
print('wrote', base + '_index.json', os.path.getsize(base + '_index.json'), 'bytes')
