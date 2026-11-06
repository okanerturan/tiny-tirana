// Render the toy bus sprite sheet: 32 headings from the map's camera; row 0 = bus (white livery), row 1 = livery mask.
// Output: data/sprites/bus.png (+ bus.json) (+ preview PNG in data/shots). Encode with cwebp/avifenc afterwards:
//   node render/sprites/make_buses.mjs && cwebp -q 92 -alpha_q 100 -exact data/sprites/bus.png -o viewer/app/transit/bus.webp
//   && avifenc -q 85 --qalpha 95 data/sprites/bus.png viewer/app/transit/bus.avif
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname), THREE = path.join(HERE, '../node_modules/three');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setRequestInterception(true);
p.on('request', q => { const u = new URL(q.url());
  if (u.hostname !== 'sprites.local') return q.continue();
  const f = u.pathname.startsWith('/three/') ? path.join(THREE, 'build', u.pathname.slice(7))
    : u.pathname.startsWith('/addons/') ? path.join(THREE, 'examples/jsm', u.pathname.slice(8)) : path.join(HERE, u.pathname.slice(1));
  if (!fs.existsSync(f)) return q.respond({ status: 404, body: '' });
  q.respond({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(f) }); });
p.on('pageerror', e => console.error('page error', e)); p.on('console', m => m.type() === 'error' && console.error(m.text()));
await p.goto('http://sprites.local/bus.html'); await p.waitForFunction(() => window.__sheet, { timeout: 60000 });
const [url, meta] = await p.evaluate(() => [window.__sheet, window.__meta]);
// preview: the sheet tinted with a few route colours, the way buses.js does it, on a map-ish background
const preview = await p.evaluate(async (url, meta) => {
  const img = new Image(); img.src = url; await img.decode();
  const { N, CELL } = meta, cols = ['#f05131', '#2f835b', '#665aa7', '#80d4f7', '#fcb567', '#b772b0'];
  const c = document.createElement('canvas'); c.width = 16 * CELL; c.height = cols.length * CELL; const g = c.getContext('2d');
  g.fillStyle = '#9a9488'; g.fillRect(0, 0, c.width, c.height);
  const tmp = document.createElement('canvas'); tmp.width = N * CELL; tmp.height = CELL; const tg = tmp.getContext('2d');
  cols.forEach((col, row) => {
    tg.globalCompositeOperation = 'copy'; tg.drawImage(img, 0, CELL, N * CELL, CELL, 0, 0, N * CELL, CELL);
    tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, N * CELL, CELL);
    const s = document.createElement('canvas'); s.width = N * CELL; s.height = CELL; const sg = s.getContext('2d');
    sg.drawImage(img, 0, 0, N * CELL, CELL, 0, 0, N * CELL, CELL); sg.globalCompositeOperation = 'multiply'; sg.drawImage(tmp, 0, 0);
    sg.globalCompositeOperation = 'destination-in'; sg.drawImage(img, 0, 0, N * CELL, CELL, 0, 0, N * CELL, CELL);
    for (let i = 0; i < 16; i++) g.drawImage(s, (i * 2) * CELL, 0, CELL, CELL, i * CELL, row * CELL, CELL, CELL);
  });
  return c.toDataURL('image/png');
}, url, meta);
const out = path.join(HERE, '../../data/sprites'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bus.png'), Buffer.from(url.split(',')[1], 'base64'));
fs.writeFileSync(path.join(out, 'bus.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(HERE, '../../data/shots/buses_sprite_preview.png'), Buffer.from(preview.split(',')[1], 'base64'));
console.log('sheet', meta); await b.close();
