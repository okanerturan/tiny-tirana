// Renders a registered mosaic of shots from one fixed orthographic camera, in ONE browser page
// (one Google 3D Tiles root request per run instead of one per shot). Resumable: existing shots are skipped.
//
// node render.js --out ../data/render/core --area U0,V0,U1,V1 [--shot 2048] [--mpp 0.146484375]
//   [--lat 41.3275 --lon 19.8187 --groundH 155 --heading 315 --tilt 45 --errorTarget 2]
// --area is in canvas pixels relative to the anchor (u right, v down); it is snapped outward to whole shots.
// Key: env GOOGLE_MAPS_API_KEY, or ~/.config/tirana-map/google_maps_api_key.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require('puppeteer-core');

const a = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) a[process.argv[i].slice(2)] = process.argv[i + 1];
const o = {
  lat: +(a.lat ?? 41.3275), lon: +(a.lon ?? 19.8187), groundH: +(a.groundH ?? 155),
  heading: +(a.heading ?? 315), tilt: +(a.tilt ?? 45), errorTarget: +(a.errorTarget ?? 2),
  shot: +(a.shot ?? 2048), mpp: +(a.mpp ?? 300 / 2048),
  h0: +(a.h0 ?? -60), h1: +(a.h1 ?? 260),          // height-pass range (metres relative to groundH)
};
// --list FILE: one "u,v" (shot top-left, canvas px) per line instead of --area; shots need not be on the grid.
if (!a.out || !(a.area || a.list)) { console.error('need --out DIR and --area U0,V0,U1,V1 or --list FILE'); process.exit(2); }
const out = path.resolve(a.out); fs.mkdirSync(out, { recursive: true });
if (a.height) fs.writeFileSync(path.join(out, 'height_range.json'), JSON.stringify({ h0: o.h0, h1: o.h1, groundH: o.groundH }));   // read by heights.decode
const S = o.shot, fl = x => Math.floor(x / S) * S, ce = x => Math.ceil(x / S) * S;
const shots = [];
let area = null;
if (a.list) {
  for (const line of fs.readFileSync(a.list, 'utf8').split('\n')) if (line.trim()) shots.push(line.split(',').map(Number));
} else {
  const [U0, V0, U1, V1] = a.area.split(',').map(Number);
  for (let v = fl(V0); v < ce(V1); v += S) for (let u = fl(U0); u < ce(U1); u += S) shots.push([u, v]);
  area = [fl(U0), fl(V0), ce(U1), ce(V1)];
}
const name = (u, v) => `shot_v${v}_u${u}.png`;
fs.writeFileSync(path.join(out, 'camera.json'), JSON.stringify({ ...o, area, list: a.list || null, note: 'pixel (u,v) relative to anchor; u right, v down' }, null, 1));

const key = process.env.GOOGLE_MAPS_API_KEY || fs.readFileSync(path.join(os.homedir(), '.config/tirana-map/google_maps_api_key'), 'utf8').trim();
const redact = s => String(s).replace(/key=[^&\s]+/g, 'key=***');
const web = path.join(__dirname, 'web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' };
const srv = http.createServer((q, r) => {
  const f = path.join(web, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(web)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
});

(async () => {
  const todo = shots.filter(([u, v]) => !fs.existsSync(path.join(out, name(u, v))));
  console.log(`${shots.length} shots, ${todo.length} to render`);
  if (!todo.length) return srv.close();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const mac = process.platform === 'darwin';
  const chrome = process.env.CHROME_PATH || (mac ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
  const gl = (process.env.RENDER_GL || (mac ? 'gpu' : 'swiftshader')) === 'gpu' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 0,
    args: [...gl, '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8192', `--window-size=${S},${S}`] });
  const p = await b.newPage(); await p.setViewport({ width: S, height: S });
  let roots = 0, reqs = 0;
  p.on('request', q => { reqs++; if (/\/v1\/3dtiles\/root\.json/.test(q.url())) roots++; });
  p.on('console', m => { const t = m.text(); if (!/THREE\.WebGLRenderer/.test(t)) console.log('[page]', redact(t)); });
  p.on('pageerror', e => console.log('[pageerror]', redact(e)));
  await p.goto(`http://127.0.0.1:${srv.address().port}/index.html`); await p.waitForFunction('window.start');
  await p.evaluate((o, k) => window.start({ ...o, key: k }), o, key);
  const t0 = Date.now();
  for (const [i, [u, v]] of todo.entries()) {
    const ts = Date.now();
    await p.evaluate((u, v) => window.setShot(u, v), u, v);
    let stable = 0, last = '';
    while (Date.now() - ts < 600e3) {
      await new Promise(r => setTimeout(r, 1500));
      const s = await p.evaluate(() => window.__st);
      const sig = `${s.loaded}/${s.visible}`;
      if (s.frames > 10 && s.downloading === 0 && s.parsing === 0 && s.progress === 1 && sig === last) { if (++stable >= 3) break; } else stable = 0;
      last = sig;
    }
    const url = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    const f = path.join(out, name(u, v));
    if (a.height) {  // --height 1: also save a 24-bit height map of the same shot (see app.js captureHeight)
      const hurl = await p.evaluate(() => window.captureHeight());
      fs.writeFileSync(f.replace(/\.png$/, '_height.png'), Buffer.from(hurl.split(',')[1], 'base64'));
    }
    fs.writeFileSync(f + '.tmp', Buffer.from(url.split(',')[1], 'base64')); fs.renameSync(f + '.tmp', f);
    console.log(`[${i + 1}/${todo.length}] ${name(u, v)} ${((Date.now() - ts) / 1000).toFixed(0)}s roots=${roots} reqs=${reqs}`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s rootRequests=${roots} totalRequests=${reqs}`);
  await b.close(); srv.close();
})().catch(e => { console.error(redact(e)); process.exit(1); });
