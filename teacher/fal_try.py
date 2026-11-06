"""Try SOTA image-edit models on fal.ai as "teachers" for hard Tirana spots.

Each model gets: image 1 = the Google render crop (1024 px, map scale), image 2 = a style tile drawn by our own
s1000 LoRA (from a different area, so no content leaks). Fidelity-first prompt (tiny.london / Toronto): say how to
draw, never what. Hard budget cap. Key: ~/.config/tirana-map/fal_key (never printed).

  python3 -I fal_try.py OUT_DIR STYLE.png spot=render.png [spot=render.png ...] [--models a,b] [--cap 5.0]
"""
import base64, concurrent.futures as cf, io, json, os, sys, time, urllib.request

KEY = open(os.path.expanduser('~/.config/tirana-map/fal_key')).read().strip()
PROMPT = (
    "Redraw image 1 as an isometric pixel-art city illustration in exactly the style of image 2: the same palette feel, "
    "soft painted shading, crisp dark outlines and small clean pixel clusters. FIDELITY COMES FIRST: draw exactly what "
    "image 1 shows, in the same positions, shapes and sizes, seen from the same camera, filling the whole frame. Add "
    "nothing that is not in image 1 and remove nothing that is. Surfaces keep their real colour variation and texture, "
    "drawn as fine pixel patterns instead of flat fills. Dark areas that are shadows stay shadows: draw them as soft "
    "darker shading on the same surface, never as new objects, paths or edges. Use nothing from image 2 except its "
    "drawing style. No border, no text, no labels.")
PROMPT_PLAIN = (
    "Redraw this image as an isometric pixel-art city illustration: soft painted shading, crisp dark outlines and small "
    "clean pixel clusters, in natural, calm colours. FIDELITY COMES FIRST: draw exactly what the image shows, in the same "
    "positions, shapes and sizes, seen from the same camera, filling the whole frame. Add nothing that is not in the image "
    "and remove nothing that is. Surfaces keep their real colour variation and texture, drawn as fine pixel patterns "
    "instead of flat fills. Dark areas that are shadows stay shadows: draw them as soft darker shading on the same surface, "
    "never as new objects, paths or edges. No border, no text, no labels.")
SIZE = {'width': 1024, 'height': 1024}
MODELS = {  # endpoint, extra args, estimated $ per call
    'nanobanana_pro': ('fal-ai/nano-banana-pro/edit', {}, 0.15),
    'gpt_image_2_6': ('openai/gpt-image-2.6/flare/edit', {'quality': 'medium', 'image_size': SIZE}, 0.12),
    'seedream_5_pro': ('bytedance/seedream/v5/pro/edit', {'image_size': SIZE}, 0.072),
    'qwen_image_3': ('alibaba/qwen-image-3/edit', {'image_size': SIZE, 'enable_prompt_expansion': False}, 0.04),
    'flux_2_max': ('fal-ai/flux-2-max/edit', {'image_size': SIZE}, 0.15),
    'nanobanana_2_1': ('google/nano-banana-2.1/edit', {'aspect_ratio': '1:1', 'resolution': '1K'}, 0.06),
    'gpt_image_2_5_sunburst': ('openai/gpt-image-2.5/sunburst/edit', {'quality': 'medium', 'image_size': SIZE}, 0.12),
}


def data_uri(path):
    return 'data:image/png;base64,' + base64.b64encode(open(path, 'rb').read()).decode()


def req(method, url, body=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                               headers={'Authorization': f'Key {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=300) as f:
        return json.loads(f.read())


def run(model, spot, ctrl, style, out_dir):
    endpoint, extra, _ = MODELS[model]
    t0 = time.time()
    body = {'prompt': PROMPT, 'image_urls': [data_uri(ctrl), data_uri(style)], **extra} if style else \
           {'prompt': PROMPT_PLAIN, 'image_urls': [data_uri(ctrl)], **extra}      # style 'none': text-only style, no style image
    sub = req('POST', f'https://queue.fal.run/{endpoint}', body)
    while True:
        st = req('GET', sub['status_url'])
        if st.get('status') == 'COMPLETED':
            break
        if st.get('status') not in ('IN_QUEUE', 'IN_PROGRESS'):
            raise RuntimeError(f'{model} {spot}: {st}')
        time.sleep(3)
    res = req('GET', sub['response_url'])
    url = res['images'][0]['url']
    out = os.path.join(out_dir, f'{spot}__{model}.png')
    from PIL import Image
    img = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).convert('RGB')
    img.save(out)
    return model, spot, out, img.size, round(time.time() - t0)


def main():
    out_dir, style = sys.argv[1], (None if sys.argv[2] == 'none' else sys.argv[2])
    spots = dict(a.split('=', 1) for a in sys.argv[3:] if '=' in a and not a.startswith('--'))
    args = sys.argv[3:]
    models = args[args.index('--models') + 1].split(',') if '--models' in args else list(MODELS)
    cap = float(args[args.index('--cap') + 1]) if '--cap' in args else 5.0
    os.makedirs(out_dir, exist_ok=True)
    jobs = [(m, s, p) for s, p in spots.items() for m in models if not os.path.exists(os.path.join(out_dir, f'{s}__{m}.png'))]
    est = sum(MODELS[m][2] for m, _, _ in jobs)
    print(f'{len(jobs)} calls, estimated ${est:.2f} (cap ${cap:.2f})', flush=True)
    if est > cap:
        sys.exit(f'estimate ${est:.2f} exceeds cap ${cap:.2f}; nothing sent')
    log = open(os.path.join(out_dir, 'log.jsonl'), 'a')
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(run, m, s, p, style, out_dir): (m, s) for m, s, p in jobs}
        for f in cf.as_completed(futs):
            m, s = futs[f]
            try:
                r = f.result(); print('ok  ', *r, flush=True)
                log.write(json.dumps({'model': m, 'spot': s, 'out': r[2], 'size': r[3], 'secs': r[4], 'est_usd': MODELS[m][2]}) + '\n')
            except Exception as e:
                print('FAIL', m, s, str(e)[:300], flush=True)
                log.write(json.dumps({'model': m, 'spot': s, 'error': str(e)[:500]}) + '\n')


if __name__ == '__main__':
    main()
