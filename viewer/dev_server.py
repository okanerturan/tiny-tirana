"""Local dev server for the viewer: static files from viewer/ plus /api/planes (live ADS-B near Tirana).

    python3 -I viewer/dev_server.py [--port 8765]

/api/planes mirrors the production Cloudflare Worker (deploy/planes-worker.js): one upstream request per 5 s no matter
how many clients poll, normalised to {now, source, planes: [{hex, flight, reg, type, lat, lon, alt_ft, ground,
gs_kt, track, vs_fpm, seen}]}. Upstreams (free, no key, no browser CORS): adsb.lol, then adsb.fi as fallback.
"""
import argparse, functools, http.server, json, mimetypes, os, socketserver, threading, time, urllib.request

CENTER = (41.36, 19.76)          # between Tirana centre and the airport (Rinas)
RADIUS_NM = 40
UPSTREAMS = [
    ('adsb.lol', f'https://api.adsb.lol/v2/lat/{CENTER[0]}/lon/{CENTER[1]}/dist/{RADIUS_NM}', 'ac'),
    ('adsb.fi', f'https://opendata.adsb.fi/api/v2/lat/{CENTER[0]}/lon/{CENTER[1]}/dist/{RADIUS_NM}', 'aircraft'),
]
TTL = 5.0
_cache = {'t': 0.0, 'body': b''}
_lock = threading.Lock()


def normalise(rows, source):
    out = []
    for a in rows:
        if a.get('lat') is None or a.get('lon') is None:
            continue
        alt = a.get('alt_baro')
        ground = alt == 'ground'
        out.append({'hex': a.get('hex'), 'flight': (a.get('flight') or '').strip(), 'reg': a.get('r') or '', 'type': a.get('t') or '',
                    'lat': a['lat'], 'lon': a['lon'], 'alt_ft': 0 if ground else (a.get('alt_geom') or alt or 0), 'ground': ground,
                    'gs_kt': a.get('gs') or 0, 'track': a.get('track') or a.get('true_heading') or 0,
                    'vs_fpm': a.get('baro_rate') or a.get('geom_rate') or 0, 'seen': a.get('seen_pos', a.get('seen', 0))})
    return {'now': time.time(), 'source': source, 'planes': out}


def fetch_planes():
    with _lock:
        if time.time() - _cache['t'] < TTL and _cache['body']:
            return _cache['body']
        body = None
        for name, url, key in UPSTREAMS:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'tiny-tirana/1.0 (personal map; dev server)'})
                with urllib.request.urlopen(req, timeout=8) as r:
                    data = json.loads(r.read())
                body = json.dumps(normalise(data.get(key) or [], name)).encode()
                break
            except Exception as e:  # try the next upstream
                last = f'{name}: {e}'
        if body is None:
            body = json.dumps({'now': time.time(), 'source': None, 'planes': [], 'error': last}).encode()
        _cache.update(t=time.time(), body=body)
        return body


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.avif': 'image/avif', '.webp': 'image/webp',
                      '.mjs': 'text/javascript', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.dzi': 'application/xml'}

    def do_GET(self):
        if self.path.split('?')[0] == '/api/planes':
            body = fetch_planes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'public, max-age=4')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if self.path.split('?')[0] == '/api/presence':      # dev stand-in for the Worker's Durable Object counter
            body = b'{"live": 1, "total": 1}'
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()

    def do_POST(self):
        # /api/e: anonymous usage events (viewer/app/analytics.js); kept locally for testing
        if self.path.split('?')[0] != '/api/e':
            self.send_error(404); return
        n = min(int(self.headers.get('Content-Length') or 0), 16384)
        body = self.rfile.read(n)
        try:
            ev = json.loads(body)
            out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'analytics_dev.jsonl')
            with open(out, 'a') as f: f.write(json.dumps(ev) + '\n')
        except Exception:
            pass
        self.send_response(204); self.end_headers()

    def end_headers(self):
        # code and data: always revalidate (a rebuilt map must never run with a stale app.js); tile images may be cached
        # for a short while but are revalidated too, since a rebuild reuses their URLs
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=8765); a = ap.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    Server(('127.0.0.1', a.port), functools.partial(Handler, directory=root)).serve_forever()
