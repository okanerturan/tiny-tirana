"""Upload a folder to R2 through the Cloudflare REST API with wrangler's OAuth login (no S3 keys needed).

    python3 -I deploy/r2_upload.py LOCAL_DIR BUCKET PREFIX [--threads 32] [--skip-existing]

Keys are PREFIX/<path relative to LOCAL_DIR's parent>, e.g. viewer/tiles_shaped -> v1/tiles_shaped/map_files/17/3_4.avif.
--skip-existing lists the bucket first and only sends files whose size differs (a rerun after a rebuild sends changes).
The token is read from wrangler's config and refreshed with `wrangler whoami` when it expires; it is never printed.
"""
import json, mimetypes, os, re, subprocess, sys, threading, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ACCT = '1992595a6b0bebdbb4d076347609333d'
CFG = os.path.expanduser('~/.wrangler/config/default.toml')
mimetypes.add_type('image/avif', '.avif'); mimetypes.add_type('image/webp', '.webp'); mimetypes.add_type('application/xml', '.dzi')
_lock = threading.Lock(); _tok = None


def token(refresh=False):
    global _tok
    with _lock:
        if refresh or _tok is None:
            if refresh:
                env = {k: v for k, v in os.environ.items() if k != 'CLOUDFLARE_API_TOKEN'}
                subprocess.run(['wrangler', 'whoami'], env=env, capture_output=True, timeout=120)
            _tok = re.search(r'oauth_token\s*=\s*"([^"]+)"', open(CFG).read()).group(1)
        return _tok


def call(method, path, data=None, ctype=None):
    for attempt in range(8):
        h = {'Authorization': f'Bearer {token()}'}
        if ctype: h['Content-Type'] = ctype
        r = urllib.request.Request('https://api.cloudflare.com/client/v4' + path, method=method, data=data, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as f: return json.load(f)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and attempt < 2: token(refresh=True); continue
            if e.code in (429, 500, 502, 503, 504): time.sleep(min(60, 2 ** attempt)); continue
            raise
        except Exception:
            time.sleep(2 ** attempt)
    raise RuntimeError(f'{method} {path} failed')


def listing(bucket, prefix):
    out, cursor = {}, None
    while True:
        q = {'prefix': prefix, 'per_page': 1000}
        if cursor: q['cursor'] = cursor
        r = call('GET', f'/accounts/{ACCT}/r2/buckets/{bucket}/objects?' + urllib.parse.urlencode(q))
        for o in r.get('result', []): out[o['key']] = o.get('size')
        cursor = (r.get('result_info') or {}).get('cursor')
        if not cursor or not (r.get('result_info') or {}).get('is_truncated'): return out


def main():
    a = sys.argv[1:]; src, bucket, prefix = a[0].rstrip('/'), a[1], a[2].strip('/')
    threads = int(a[a.index('--threads') + 1]) if '--threads' in a else 32
    base = os.path.dirname(src); files = []
    for d, _, fs in os.walk(src):
        for f in fs:
            if f.startswith('.'): continue
            p = os.path.join(d, f); files.append((p, f'{prefix}/{os.path.relpath(p, base)}'))
    have = listing(bucket, f'{prefix}/{os.path.basename(src)}/') if '--skip-existing' in a else {}
    todo = [(p, k) for p, k in files if have.get(k) != os.path.getsize(p)]
    print(f'{len(files)} files, {len(todo)} to upload ({sum(os.path.getsize(p) for p, _ in todo) / 1e9:.2f} GB)', flush=True)
    done = [0]; t0 = time.time()
    failed = []
    def up(item):
        p, k = item
        try:
            call('PUT', f'/accounts/{ACCT}/r2/buckets/{bucket}/objects/{urllib.parse.quote(k)}', open(p, 'rb').read(), mimetypes.guess_type(p)[0] or 'application/octet-stream')
        except Exception:
            with _lock: failed.append(item)
            return
        with _lock:
            done[0] += 1
            if done[0] % 1000 == 0: print(f'  {done[0]}/{len(todo)} in {time.time() - t0:.0f}s', flush=True)
    with ThreadPoolExecutor(threads) as ex: list(ex.map(up, todo))
    for rnd in range(3):                                    # failures (throttling) get slower retries at the end
        if not failed: break
        retry, failed[:] = list(failed), []; time.sleep(30)
        print(f'  retry round {rnd + 1}: {len(retry)} files', flush=True)
        with ThreadPoolExecutor(8) as ex: list(ex.map(up, retry))
    print(f'UPLOAD_DONE {done[0]} files in {time.time() - t0:.0f}s' + (f', {len(failed)} FAILED' if failed else ''), flush=True)


if __name__ == '__main__':
    main()
