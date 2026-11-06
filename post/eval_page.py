"""Build viewer/eval_v3/ for the compare page: per held-out spot, render vs v1 (s1000 map crop) vs every v3 checkpoint.
ai-toolkit sample files are <timestamp>__<step:09d>_<i>.jpg; i follows the sample list order in train/v3.yaml.
    python3 -I post/eval_page.py SAMPLES_DIR
Open: viewer/compare/index.html?m=../eval_v3/manifest.json&img=../eval_v3/img
"""
import glob, json, os, re, sys
from PIL import Image

SPOTS = ['mother_teresa_sq', 'lake_dam', 'air_albania', 'resid_holdout']   # same order as v3.yaml samples
out = 'viewer/eval_v3'; os.makedirs(out + '/img', exist_ok=True)
steps = {}
for f in glob.glob(os.path.join(sys.argv[1], '*')):
    m = re.search(r'__(\d{9})_(\d+)\.(jpg|png|webp)$', f)
    if m:
        steps.setdefault(int(m.group(1)), {})[int(m.group(2))] = f
man = {}
for i, s in enumerate(SPOTS):
    man[s] = []
    for name, p in [('render', f'data/teacher/frames/heldout/{s}.png'), ('s1000_ours', f'data/eval_v3/s1000/{s}.png')] + \
                   [(f'v3_step_{st:04d}', steps[st].get(i)) for st in sorted(steps)]:
        if not p or not os.path.exists(p):
            continue
        Image.open(p).convert('RGB').resize((1024, 1024), Image.LANCZOS).save(f'{out}/img/{s}__{name}.webp', quality=92, method=5)
        man[s].append(name)
json.dump(man, open(f'{out}/manifest.json', 'w'), indent=1)
print({k: len(v) for k, v in man.items()}, 'checkpoints:', sorted(steps))
