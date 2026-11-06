"""Build viewer/pairs/: a review gallery of accepted teacher pairs (render vs teacher drawing) with QA metrics.
    python3 -I post/pairs_gallery.py data/teacher/pairs_v3
"""
import glob, json, os, sys
from PIL import Image

src = sys.argv[1]
out = 'viewer/pairs'; os.makedirs(out + '/img', exist_ok=True)
log = {}
for l in open(os.path.join(src, 'log.jsonl')):
    r = json.loads(l)
    if r.get('ok'): log[r['slug']] = r
man, cards = {}, []
for t in sorted(glob.glob(os.path.join(src, 'target', '*.png'))):
    slug = os.path.basename(t)[:-4]
    c = os.path.join(src, 'control', slug + '.png')
    for name, p in (('render', c), ('teacher', t)):
        dst = f'{out}/img/{slug}__{name}.webp'
        if not os.path.exists(dst):
            Image.open(p).convert('RGB').save(dst, quality=88, method=5)
    man[slug] = ['render', 'teacher']
    r = log.get(slug, {})
    cards.append({'slug': slug, 'edge': r.get('edge_corr'), 'block': r.get('block_edge_corr_min'), 'try': r.get('try', 0) + 1})
json.dump(man, open(f'{out}/manifest.json', 'w'))
json.dump(cards, open(f'{out}/cards.json', 'w'))
print(len(cards), 'pairs ->', out)
