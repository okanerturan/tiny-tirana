// Render a toy plane sprite sheet: 32 headings x 3 liveries from the map's camera.
// node make_planes.mjs            -> airliner, viewer/app/planes/sheet.png (live planes)
// node make_planes.mjs prop.html prop -> single-prop, viewer/app/planes/prop.png (Play mode)
const [PAGE = 'plane.html', NAME = 'sheet'] = process.argv.slice(2);
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname), THREE_DIR = path.join(HERE, '../node_modules/three/build');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setRequestInterception(true);
p.on('request', q => { const u = new URL(q.url());
  if (u.hostname !== 'sprites.local') return q.continue();
  const f = u.pathname.startsWith('/three/') ? path.join(THREE_DIR, u.pathname.slice(7)) : path.join(HERE, u.pathname.slice(1));
  if (!fs.existsSync(f)) return q.respond({ status: 404, body: '' });
  q.respond({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(f) }); });
p.on('pageerror', e => console.error('page error', e)); p.on('console', m => m.type() === 'error' && console.error(m.text()));
await p.goto('http://sprites.local/' + PAGE); await p.waitForFunction(() => window.__sheet, { timeout: 60000 });
const [url, meta] = await p.evaluate(() => [window.__sheet, window.__meta]);
const out = path.join(HERE, '../../viewer/app/planes'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, NAME + '.png'), Buffer.from(url.split(',')[1], 'base64'));
fs.writeFileSync(path.join(out, NAME + '.json'), JSON.stringify(meta)); console.log('sheet', meta); await b.close();
