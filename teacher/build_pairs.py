"""Make training pairs: teacher = GPT Image 2.5 Sunburst (medium) with a FLUX.2 Max style reference, checked
automatically against the render (qa.py). Up to 3 tries per frame, then the frame is dropped. Hard $ cap.
Resumable: frames with an accepted target are skipped.

    python3 -I build_pairs.py FRAMES_DIR OUT_DIR --cap 12
FRAMES_DIR holds render frames (*.png, 1024 px). OUT_DIR gets control/, target/, rejected/ and log.jsonl.
"""
import argparse, concurrent.futures as cf, glob, json, os, sys, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fal_try as F
from qa import metrics

STYLE_DEFAULT = 'data/teacher/fal/lakeshore__flux_2_max.png'    # trees/water, no buildings to paste
STYLE_ALT = 'data/teacher/fal/pyramid__flux_2_max.png'          # used for frames near the lake shore spot
COST = 0.06  # conservative $ per medium Sunburst call with 2 input images
PASS = lambda m: 0.45 <= m['edge_corr'] <= 0.85 and (m['block_edge_corr_min'] is None or m['block_edge_corr_min'] >= 0.25)

lock = threading.Lock()
spent = 0.0


def one(frame, out, cap, tries=3):
    global spent
    slug = os.path.basename(frame)[:-4]
    tgt = os.path.join(out, 'target', slug + '.png')
    if os.path.exists(tgt):
        return slug, 'cached', None
    style = STYLE_ALT if slug.startswith('lake') else STYLE_DEFAULT
    for t in range(tries):
        with lock:
            if spent + COST > cap:
                return slug, 'budget', None
            spent += COST
        tmp = os.path.join(out, 'tmp'); os.makedirs(tmp, exist_ok=True)
        try:
            _, _, path, size, secs = F.run('gpt_image_2_5_sunburst', f'{slug}_t{t}', frame, style, tmp)
        except Exception as e:
            log(out, {'slug': slug, 'try': t, 'error': str(e)[:300]}); continue
        m = metrics(frame, path); ok = size == (1024, 1024) and PASS(m)
        log(out, {'slug': slug, 'try': t, 'ok': ok, 'secs': secs, **m})
        if ok:
            os.replace(path, tgt)
            os.link(frame, os.path.join(out, 'control', slug + '.png')) if not os.path.exists(os.path.join(out, 'control', slug + '.png')) else None
            return slug, f'ok (try {t + 1})', m
        os.replace(path, os.path.join(out, 'rejected', f'{slug}_t{t}.png'))
    return slug, 'dropped', None


def log(out, rec):
    with lock, open(os.path.join(out, 'log.jsonl'), 'a') as f:
        f.write(json.dumps({'t': time.strftime('%H:%M:%S'), **rec}) + '\n')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('frames'); ap.add_argument('out'); ap.add_argument('--cap', type=float, default=12)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    for d in ('control', 'target', 'rejected'):
        os.makedirs(os.path.join(a.out, d), exist_ok=True)
    frames = sorted(glob.glob(os.path.join(a.frames, '*.png')))
    print(f'{len(frames)} frames, cap ${a.cap:.2f}', flush=True)
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for slug, status, m in ex.map(lambda f: one(f, a.out, a.cap), frames):
            print(f'{slug:<28} {status}', m or '', flush=True)
    n = len(glob.glob(os.path.join(a.out, 'target', '*.png')))
    print(f'accepted {n}/{len(frames)}; spent (est.) ${spent:.2f}', flush=True)


if __name__ == '__main__':
    main()
