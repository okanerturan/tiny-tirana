// Social preview images (1200 x 630 JPEG) for tirana.fyi.
//   node deploy/og.mjs [site] [landmarks]      (dev server on 127.0.0.1:8765, viewer/dev_server.py)
// site:      viewer/app/og/tirana.jpg   central Tirana up close, title on the left
// landmarks: viewer/app/og/lm/<id>.jpg  the landmark's map view with its diorama art and name
// Only our own material goes in: the painting and the generated art, never the Wikimedia photos (their licences
// ask for credit next to the image, which a link preview cannot show).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(ROOT, 'render', 'package.json'));
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(ROOT, 'viewer', 'app', 'og'); fs.mkdirSync(path.join(OUT, 'lm'), { recursive: true });
const want = process.argv.slice(2); const all = !want.length;
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });

if (all || want.includes('site')) {
  const pg = await b.newPage(); await pg.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await pg.goto('http://127.0.0.1:8765/app/index.html?lang=en&planes=off', { waitUntil: 'load' }); await sleep(3000);
  // the whole island, nudged to the right half; then hide every control and put the title on the left
  // central Tirana (Skanderbeg Square, the boulevard, the Pyramid), shifted right so the title panel doesn't cover it
  await pg.evaluate(() => { const v = window.__tt.viewer; window.__tt.go(41.3245, 19.8195, 0.11, true);
    v.viewport.panBy(v.viewport.deltaPointsFromPixels(new OpenSeadragon.Point(-270, 0)), true); });
  await sleep(7000);
  await pg.addStyleTag({ content: `.shell > *:not(#map), .navigator, .planes-layer, .tilt, #card, .toast, .lm { display: none !important; }` });
  await pg.evaluate(font => { const d = document.createElement('div'); d.innerHTML = `
    <div style="position:fixed; inset-block:0; inset-inline-start:0; inline-size:540px; padding:58px 0 0 60px; font-family:${font}; color:white; z-index:9;
      background:oklch(0.21 0.02 250); box-shadow:24px 0 60px oklch(0 0 none / 0.35); border-start-end-radius:0;">
      <img src="brand/logo-96.webp" width="84" height="84" alt="" style="display:block; margin-block-end:20px">
      <div style="font-size:74px; font-weight:800; letter-spacing:-0.02em; line-height:1">Tiny Tirana</div>
      <div style="font-size:30px; line-height:1.32; margin-block-start:20px; max-inline-size:430px; color:oklch(0.9 0.01 250)">An isometric pixel-art map of Tirana: 46 landmarks, live planes, buses and the Dajti cable car</div>
      <div style="display:inline-block; margin-block-start:32px; padding:10px 24px; border-radius:999px; background:oklch(0.72 0.15 65); color:oklch(0.22 0.05 65); font-size:30px; font-weight:800">tirana.fyi</div>
    </div>`; document.body.append(d.firstElementChild); }, FONT);
  await sleep(800);
  await pg.screenshot({ path: path.join(OUT, 'tirana.jpg'), type: 'jpeg', quality: 86 }); await pg.close(); console.log('og/tirana.jpg');
}

if (all || want.includes('landmarks')) {
  const src = fs.readFileSync(path.join(ROOT, 'viewer', 'app', 'landmarks.js'), 'utf8');
  const { LANDMARKS } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const pg = await b.newPage(); await pg.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  const lmDir = 'http://127.0.0.1:8765/app/lm';   // served: a generated page may not load file:// images
  for (const p of LANDMARKS) {
    const art = fs.existsSync(path.join(ROOT, 'viewer', 'app', 'lm', `${p.id}-diorama.webp`)) ? `${lmDir}/${p.id}-diorama.webp` : null;
    await pg.setContent(`<!doctype html><html><body style="margin:0; inline-size:1200px; block-size:630px; overflow:clip; font-family:${FONT}; background:#eee">
      <img src="${lmDir}/${p.id}-map.webp" style="position:absolute; inset:0; inline-size:100%; block-size:100%; object-fit:cover">
      <div style="position:absolute; inset:0; background:linear-gradient(0deg, oklch(0.18 0.01 250 / 0.82), oklch(0.18 0.01 250 / 0) 58%)"></div>
      ${art ? `<div style="position:absolute; inset-block:36px; inset-inline-end:40px; inline-size:372px; border-radius:26px; overflow:clip; background:oklch(0.959 0.037 83); box-shadow:0 14px 40px oklch(0 0 none / 0.45)">
        <img src="${art}" style="inline-size:100%; block-size:100%; object-fit:contain"></div>` : ''}
      <div style="position:absolute; inset-inline-start:56px; inset-block-end:52px; max-inline-size:${art ? 680 : 1080}px; color:white">
        <div style="display:inline-block; padding:6px 16px; border-radius:999px; background:oklch(0.72 0.15 65); color:oklch(0.25 0.05 65); font-size:24px; font-weight:700">${p.kind.en}</div>
        <div style="font-size:64px; font-weight:800; letter-spacing:-0.015em; line-height:1.05; margin-block-start:16px; text-wrap:balance">${p.name.en}</div>
        <div style="font-size:28px; margin-block-start:14px; opacity:0.92">${p.name.sq !== p.name.en ? p.name.sq + ' · ' : ''}Tiny Tirana · tirana.fyi</div>
      </div></body></html>`, { waitUntil: 'load' });
    await sleep(150);
    await pg.screenshot({ path: path.join(OUT, 'lm', `${p.id}.jpg`), type: 'jpeg', quality: 84 });
  }
  console.log(`og/lm: ${LANDMARKS.length} images`);
}
await b.close();
