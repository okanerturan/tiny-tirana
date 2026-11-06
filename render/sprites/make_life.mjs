// Render the city-life sprite sheets from the map's camera: lake birds (Muscovy ducks, ducklings, coots, grebes, swans;
// 16 headings) and toy cars (8 paints, 32 headings).
// Output: viewer/app/life/{birds,cars}.{webp,avif} + {birds,cars}.json.   node render/sprites/make_life.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname), THREE = path.join(HERE, '../node_modules/three');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setRequestInterception(true);
p.on('request', q => { const u = new URL(q.url());
  if (u.hostname !== 'sprites.local') return q.continue();
  const f = u.pathname.startsWith('/three/') ? path.join(THREE, 'build', u.pathname.slice(7))
    : u.pathname.startsWith('/three-addons/') ? path.join(THREE, 'examples/jsm', u.pathname.slice(14)) : path.join(HERE, u.pathname.slice(1));
  if (!fs.existsSync(f)) return q.respond({ status: 404, body: '' });
  q.respond({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(f) }); });
p.on('pageerror', e => console.error('page error', e)); p.on('console', m => m.type() === 'error' && console.error(m.text()));
const out = path.join(HERE, '../../viewer/app/life'); fs.mkdirSync(out, { recursive: true });
for (const name of ['birds', 'cars']) {
  await p.goto(`http://sprites.local/life.html?sheet=${name}`); await p.waitForFunction(() => window.__sheet, { timeout: 30000 });
  const [url, meta] = await p.evaluate(() => [window.__sheet, window.__meta]);
  const png = path.join(out, `.${name}.tmp.png`); fs.writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
  execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', '-alpha_filter', 'best', png, '-o', path.join(out, `${name}.webp`)]);
  execFileSync('avifenc', ['-q', '62', '--qalpha', '80', '-s', '4', png, path.join(out, `${name}.avif`)], { stdio: 'ignore' });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(meta));
  fs.unlinkSync(png);
  for (const f of [`${name}.webp`, `${name}.avif`]) console.log(f, (fs.statSync(path.join(out, f)).size / 1024).toFixed(0), 'KB');
}
await b.close();
