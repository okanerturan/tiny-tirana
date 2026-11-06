"""Build viewer/scenes/ for the compare page: per scene render | v1 | v3 checkpoints (heading 315).
    python3 -I post/scenes_page.py
Open: viewer/compare/index.html?m=../scenes/manifest.json&img=../scenes/img&title=...
"""
import json, os
from PIL import Image
meta = json.load(open('data/scenes/scenes.json'))
out = 'viewer/scenes'; os.makedirs(out + '/img', exist_ok=True)
models = ['render', 'v1', 's0750', 's1000', 's1250', 's1500', 's1750', 's2000']
man = {}
for k, v in meta.items():
    key = f"{k}{'_unseen' if v['note'] == 'unseen' else ''}"
    man[key] = []
    for mdl in models:
        src = f'data/scenes/{k}.png' if mdl == 'render' else f'data/scenes/out/{mdl}_{k}.png'
        if not os.path.exists(src): continue
        Image.open(src).convert('RGB').save(f'{out}/img/{key}__{mdl}.webp', quality=90, method=5)
        man[key].append(mdl)
json.dump(man, open(f'{out}/manifest.json', 'w'), indent=1)
print({k: len(v) for k, v in man.items()})
