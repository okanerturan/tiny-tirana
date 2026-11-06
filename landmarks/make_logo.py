"""4 app-icon concepts via GPT Image 2.6 (edit, our landmark icons as references). Output: data/landmarks/logo/<name>.png"""
import base64, concurrent.futures as cf, json, os, time, urllib.request
KEY = open(os.path.expanduser('~/.config/tirana-map/fal_key')).read().strip()
G = 'data/landmarks/gen'
BASE = ("Design a square app icon / logo mark for an isometric pixel-art map of Tirana, Albania. Same art style as the reference "
        "image(s): isometric view from above at 45 degrees, painted pixel art, clean dark outlines. It must stay readable at 32x32 px: "
        "one bold simple silhouette, few colours, no tiny details, centred, filling about 85% of the frame, transparent background. "
        "No text, no letters, no numbers, no border, no rounded-square background.\n\nCONCEPT: ")
C = {
 'pyramid_tile': ('A tiny floating isometric diamond-shaped tile of city ground (a slice of land with a thin earth edge) with the white Pyramid of Tirana and its colourful boxes on top, and one or two small trees.', ['pyramid__icon.png']),
 'clock_tile': ('A tiny floating isometric diamond-shaped tile of city ground with the slim stone Clock Tower of Tirana standing tall on it next to a small grey-blue mosque dome.', ['clock__icon.png', 'mosque__icon.png']),
 'statue_tile': ('A tiny floating isometric diamond-shaped tile of paved square with the bronze Skanderbeg equestrian statue on its pale rock plinth in the middle.', ['statue__icon.png']),
 'city_cube': ('A single isometric cube whose top face is a tiny painted city block (red roofs, green trees, one white pyramid) and whose two side faces show layered earth in warm terracotta and brown, like a slice of the map lifted out.', ['pyramid__icon.png']),
}
def uri(p): return 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
def req(m, u, b=None):
    r = urllib.request.Request(u, method=m, data=json.dumps(b).encode() if b else None, headers={'Authorization': f'Key {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=300) as f: return json.loads(f.read())
def one(item):
    name, (concept, refs) = item
    sub = req('POST', 'https://queue.fal.run/openai/gpt-image-2.6/flare/edit', {'prompt': BASE + concept, 'image_urls': [uri(f'{G}/{r}') for r in refs],
          'background': 'transparent', 'quality': 'medium', 'image_size': {'width': 1024, 'height': 1024}, 'output_format': 'png'})
    while (st := req('GET', sub['status_url'])).get('status') != 'COMPLETED':
        if st.get('status') not in ('IN_QUEUE', 'IN_PROGRESS'): raise RuntimeError(st)
        time.sleep(3)
    open(f'data/landmarks/logo/{name}.png', 'wb').write(urllib.request.urlopen(req('GET', sub['response_url'])['images'][0]['url']).read())
    return name
print('4 concepts, est $0.40')
with cf.ThreadPoolExecutor(4) as ex:
    for n in ex.map(one, C.items()): print('ok', n)
