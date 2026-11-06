"""Labelled comparison grid of same-size images.  compare_grid.py OUT.jpg CELL_PX label=path [label=path ...]"""
import sys
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
out, cell = sys.argv[1], int(sys.argv[2])
items = [a.split('=', 1) for a in sys.argv[3:]]
cols = 4 if len(items) > 6 else min(3, len(items)); rows = -(-len(items) // cols)
pad = 36
g = Image.new('RGB', (cols * cell, rows * (cell + pad)), (20, 22, 26))
d = ImageDraw.Draw(g)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 24)
except OSError:
    font = ImageFont.load_default()
for i, (label, path) in enumerate(items):
    x, y = (i % cols) * cell, (i // cols) * (cell + pad)
    g.paste(Image.open(path).convert('RGB').resize((cell, cell), Image.LANCZOS), (x, y + pad))
    d.text((x + 10, y + 6), label, fill=(242, 239, 232), font=font)
g.save(out, quality=88)
print(out, g.size)
