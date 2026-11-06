#!/usr/bin/env node
// Tiny Tirana driver: serve + drive the viewer, check the renderer's registration invariant.
// Run from the unit root (tirana/):  node .claude/skills/run-tirana/driver.mjs <command> [options]
//
//   serve   [--port 8765]                         start a static server for viewer/ (background, idempotent)
//   stop    [--port 8765]                         stop it
//   shot    --tiles DIR [--place NAME] [--mix 0-100] [--out FILE] [--size 1280x800] [--port 8765]
//           open the viewer, wait until every visible tile is loaded, optionally click a place and move the
//           painted<->render slider, screenshot. Prints a JSON status line; exits 1 on page errors.
//   render-check [--out DIR]                      render one 2048 px area as 1x2048 and 4x1024 shots and compare
//                                                 (uses 2 Google root requests; needs the Maps key). Exits 1 if <99%.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const UNIT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const require = createRequire(path.join(UNIT, 'render/package.json'));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
const port = +(opt.port || 8765);
const pidFile = path.join(UNIT, 'data', `viewer-${port}.pid`);

const portOpen = p => new Promise(r => { const s = net.connect(p, '127.0.0.1'); s.on('connect', () => { s.end(); r(true); }); s.on('error', () => r(false)); });

async function serve() {
  if (await portOpen(port)) return console.log(`viewer already served on http://127.0.0.1:${port}/`);
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  // viewer/dev_server.py = static files + /api/planes (live ADS-B proxy, same contract as deploy/planes-worker.js)
  const p = spawn('python3', ['-I', path.join(UNIT, 'viewer', 'dev_server.py'), '--port', String(port)], { cwd: path.join(UNIT, 'viewer'), detached: true, stdio: 'ignore' });
  p.unref(); fs.writeFileSync(pidFile, String(p.pid));
  for (let i = 0; i < 50 && !(await portOpen(port)); i++) await new Promise(r => setTimeout(r, 100));
  console.log(`serving viewer/ on http://127.0.0.1:${port}/ (pid ${p.pid})`);
}

function stop() {
  // Kill whatever listens on the port (also servers not started by this driver), then drop the pid file.
  let pids = [];
  try { pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).toString().trim().split('\n').filter(Boolean); } catch {}
  for (const pid of pids) try { process.kill(+pid); } catch {}
  fs.rmSync(pidFile, { force: true });
  console.log(pids.length ? `stopped listener(s) on :${port}: ${pids.join(' ')}` : `nothing listening on :${port}`);
}

async function shot() {
  if (!opt.tiles) throw new Error('--tiles DIR (relative to viewer/) is required, e.g. --tiles tiles_pilot');
  if (!(await portOpen(port))) await serve();
  const [w, h] = String(opt.size || '1280x800').split('x').map(Number);
  const out = path.resolve(opt.out || path.join(UNIT, 'data/shots/viewer.png'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const puppeteer = require('puppeteer-core');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await b.newPage(); await p.setViewport({ width: w, height: h });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('requestfailed', r => errors.push(`requestfailed ${r.url()}`));
  p.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await p.goto(`http://127.0.0.1:${port}/index.html?tiles=${encodeURIComponent(opt.tiles)}`);
  // `viewer` is a top-level const in the page. Both layers must exist; every VISIBLE layer must be fully
  // loaded (OSD never loads tiles of a layer at opacity 0, so the hidden render layer never "finishes").
  const settled = () => p.waitForFunction(() => {
    if (typeof viewer === 'undefined' || viewer.world.getItemCount() !== 2 || viewer.isAnimating?.()) return false;
    for (let i = 0; i < 2; i++) { const it = viewer.world.getItemAt(i); if (it.getOpacity() > 0 && !it.getFullyLoaded()) return false; }
    return true;
  }, { timeout: 60000, polling: 250 });
  await settled();
  if (opt.place) {
    const ok = await p.evaluate(name => { const btn = [...document.querySelectorAll('#places button')].find(x => x.textContent === name); btn?.click(); return !!btn; }, opt.place);
    if (!ok) throw new Error(`no place button named "${opt.place}" (see viewer/places.json)`);
    await new Promise(r => setTimeout(r, 1500)); await settled();
  }
  if (opt.mix !== undefined) {
    await p.evaluate(v => { const s = document.getElementById('mix'); s.value = v; s.dispatchEvent(new Event('input')); }, String(opt.mix));
    await settled();
  }
  await new Promise(r => setTimeout(r, 300));
  await p.screenshot({ path: out });
  const st = await p.evaluate(() => {
    const m = viewer.world.getItemAt(1), r = viewer.world.getItemAt(0);
    return { items: viewer.world.getItemCount(), imageZoom: +m.viewportToImageZoom(viewer.viewport.getZoom(true)).toFixed(3),
      mapOpacity: m.getOpacity(), renderOpacity: r.getOpacity(), size: m.getContentSize() };
  });
  await b.close();
  console.log(JSON.stringify({ out, ...st, errors }));
  if (errors.length) process.exit(1);
}

function renderCheck() {
  const out = path.resolve(opt.out || path.join(UNIT, 'data/render/check'));
  const big = path.join(out, 'big'), small = path.join(out, 'small');
  fs.rmSync(out, { recursive: true, force: true });
  const run = (dir, s) => execFileSync('node', ['render.js', '--out', dir, '--area', '-1024,-1024,1024,1024', '--shot', String(s)], { cwd: path.join(UNIT, 'render'), stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim().split('\n').pop();
  console.log('2048 shots:', run(big, 2048));
  console.log('1024 shots:', run(small, 1024));
  const py = `
import sys, glob, re, numpy as np
from PIL import Image
def canvas(d):
    c = Image.new('RGB', (2048, 2048), (255, 0, 255))
    for f in glob.glob(d + '/shot_v*_u*.png'):
        v, u = map(int, re.search(r'shot_v(-?\\d+)_u(-?\\d+)', f).groups()); c.paste(Image.open(f).convert('RGB'), (u + 1024, v + 1024))
    return np.asarray(c).astype(int)
a, b = canvas(sys.argv[1]), canvas(sys.argv[2]); d = np.abs(a - b).max(2)
hole = ((b[..., 0] == 255) & (b[..., 1] == 0) & (b[..., 2] == 255)).mean()
print(f'identical {100 * (d == 0).mean():.2f}%  within8 {100 * (d <= 8).mean():.2f}%  holes {100 * hole:.3f}%')
sys.exit(0 if (d <= 8).mean() > 0.99 else 1)`;
  const res = execFileSync('python3', ['-I', '-c', py, big, small]).toString().trim();
  console.log('registration:', res);
}

const cmds = { serve, stop, shot, 'render-check': renderCheck };
if (!cmds[cmd]) { console.error('commands: serve | stop | shot | render-check  (see header of this file)'); process.exit(2); }
Promise.resolve(cmds[cmd]()).catch(e => { console.error(String(e?.stack || e).replace(/key=[^&\s]+/g, 'key=***')); process.exit(1); });
