#!/usr/bin/env node
// Whole-app QA for Tiny Tirana: run from the unit root after any change.
//   node .claude/skills/run-tirana/qa_app.mjs [--port 8765] [--shots data/shots/qa]
// Exits 1 if any check fails. Prints one line per check.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const UNIT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const require = createRequire(path.join(UNIT, 'render/package.json'));
const puppeteer = require('puppeteer-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg('port', '8765'), SHOTS = path.resolve(UNIT, arg('shots', 'data/shots/qa'));
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/app/index.html`;
const results = []; const ok = (name, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
async function open(q = '', hash = '', vp = { width: 1440, height: 900 }) {
  const pg = await b.newPage(); await pg.setViewport(vp);
  const errs = [], bad = [];
  pg.on('pageerror', e => errs.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await pg.goto(`${BASE}?${q}${hash}`, { waitUntil: 'load' }); await sleep(3500);
  return { pg, errs, bad };
}

// 1. desktop load, English
{
  const { pg, errs, bad } = await open('lang=en', '#41.3262,19.8196,0.3');
  ok('desktop loads without errors', !errs.length && !bad.length, [...errs, ...bad].slice(0, 3).join(' | '));
  ok('map has tiles', await pg.evaluate(() => window.__tt?.viewer.world.getItemCount() >= 1));
  const nLm = (await pg.$$('.lm')).length;   // landmarks.js has 30; those off the painting (under clouds) get no marker
  ok(`landmark markers present (${nLm})`, nLm >= 25);
  ok('minimap dots present (one per marker)', (await pg.$$('.mm-dot')).length === nLm);
  const labels = await pg.$$eval('.side .btn:not([hidden])', l => l.map(x => x.getAttribute('aria-label')));
  ok('side buttons all labelled', labels.every(x => x && x !== 'undefined'), labels.join(', '));
  // every visible toggle flips aria-pressed and back without errors
  for (const id of await pg.$$eval('.side .btn[aria-pressed]:not([hidden]):not(#playBtn)', l => l.map(x => x.id))) {   // Play opens a menu
    const before = await pg.$eval('#' + id, x => x.getAttribute('aria-pressed'));
    await pg.click('#' + id); await sleep(500); const mid = await pg.$eval('#' + id, x => x.getAttribute('aria-pressed'));
    await pg.click('#' + id); await sleep(500); const after = await pg.$eval('#' + id, x => x.getAttribute('aria-pressed'));
    ok(`toggle #${id}`, before !== mid && before === after, `${before}→${mid}→${after}`);
  }
  // landmark card: open, tabs, next, close
  { const el = await pg.$('.lm[aria-label="Pyramid of Tirana"] .lm-chip'); const bx = await el.boundingBox(); await pg.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); }   // real click (OSD MouseTracker)
  await sleep(2200);
  ok('card opens', await pg.$eval('#card', c => !c.hidden));
  const fits = await pg.evaluate(() => { const c = document.getElementById('card'), b = c.querySelector('.card-body'); return c.scrollHeight <= c.clientHeight + 1 && b.scrollHeight <= b.clientHeight + 1; });
  ok('card fits without scrolling', fits);
  for (const v of ['poster', 'photo', 'map', 'diorama']) {
    await pg.click(`.tabs-v [data-v=${v}]`); await sleep(350);
    ok(`card tab ${v}`, await pg.evaluate(v => { const i = document.querySelector(`.stage img[data-v=${v}]`); return getComputedStyle(i).opacity > 0.5 && i.complete && i.naturalWidth > 0; }, v));
  }
  await pg.screenshot({ path: path.join(SHOTS, 'card.png') });
  await pg.keyboard.press('Escape'); await sleep(300);
  ok('card closes with Esc', await pg.$eval('#card', c => c.hidden));
  // search
  const hits = await pg.evaluate(async () => (await window.__tt.search('piramida')).length);
  ok('search finds the Pyramid', hits > 0, String(hits));
  // max zoom cap
  for (let i = 0; i < 14; i++) { await pg.mouse.move(700, 450); await pg.mouse.wheel({ deltaY: -400 }); await sleep(80); }
  await sleep(1200);
  const z = await pg.evaluate(() => { const v = window.__tt.viewer, it = v.world.getItemAt(0); return it.viewportToImageZoom(v.viewport.getZoom(true)); });
  ok('zoom capped at 0.8', z <= 0.81, z.toFixed(2));
  await pg.close();
}
// 2. buses: demo, lines menu, select a line, follow
{
  const { pg, errs, bad } = await open('lang=en&buses=demo', '#41.3262,19.8196,0.3');
  if (await pg.$eval('#busesBtn', x => x.getAttribute('aria-pressed')) !== 'true') { await pg.click('#busesBtn'); await sleep(3000); }
  const chip = await pg.$eval('#busesChip', x => x.textContent);
  ok('buses run in demo', /\d+ buses/.test(chip), chip.trim().slice(0, 60));
  await pg.evaluate(() => [...document.querySelectorAll('#busesChip button')].find(b => /lines|linjat/i.test(b.textContent))?.click()); await sleep(800);
  const rows = await pg.$$eval('.bl-row', l => l.length).catch(() => 0);
  ok('lines menu lists lines', rows > 20, String(rows));
  ok('buses: no errors', !errs.length && !bad.length, [...errs, ...bad].slice(0, 3).join(' | '));
  await pg.screenshot({ path: path.join(SHOTS, 'buses.png') });
  await pg.close();
}
// 3. Albanian
{
  const { pg, errs } = await open('lang=sq', '#41.3262,19.8196,0.3');
  const sq = await pg.$eval('#lmBtn', x => x.getAttribute('aria-label'));
  ok('Albanian labels', sq === 'Pikat kryesore', sq);
  ok('Albanian: no errors', !errs.length, errs.slice(0, 2).join(' | '));
  await pg.close();
}
// 4. phone
{
  const { pg, errs, bad } = await open('lang=en', '#41.3262,19.8196,0.3', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  ok('phone: no errors', !errs.length && !bad.length, [...errs, ...bad].slice(0, 3).join(' | '));
  ok('phone: no sideways scroll', !(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await pg.evaluate(() => document.querySelector('.lm:not(.off)')?.focus()); await pg.keyboard.press('Enter'); await sleep(2000);   // keyboard path
  ok('phone: card fits', await pg.evaluate(() => { const c = document.getElementById('card'); return !c.hidden && c.scrollHeight <= c.clientHeight + 1; }));
  await pg.screenshot({ path: path.join(SHOTS, 'phone.png') });
  await pg.close();
}
// 5. airport island + planes demo
{
  const { pg, errs, bad } = await open('lang=en&planes=demo', '#41.4150,19.7205,0.15');
  // one merged map now: the terminal (ground 74 m) must be on the painting
  ok('airport painted (terminal on the map)', await pg.evaluate(async () => { const V = await import('./vehicles.js'), [x, y] = window.__tt.toImage(41.41917, 19.71422, 74);
    return V.isPainted(x + window.__tt.origin[0], y + window.__tt.origin[1]); }));
  ok('demo planes', (await pg.$$('.plane')).length >= 3);
  ok('airport: no errors', !errs.length && !bad.length, [...errs, ...bad].slice(0, 3).join(' | '));
  await pg.screenshot({ path: path.join(SHOTS, 'airport.png') });
  await pg.close();
}
// 6. other pages
for (const p of ['how.html', '../world/index.html', '../index.html']) {
  const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  pg.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
  await pg.goto(BASE.replace('index.html', p), { waitUntil: 'networkidle2' }); await sleep(800);
  ok(`page ${p}`, !errs.length, errs.slice(0, 2).join(' | ')); await pg.close();
}
// 7. live layers: acceptance thresholds for cars, birds, buses, migrants, tilt-shift, clipping to the painting
{
  const { pg, errs, bad } = await open('lang=en&buses=demo', '#41.3262,19.8196,0.45');
  if (await pg.$eval('#busesBtn', x => x.getAttribute('aria-pressed')) !== 'true') { await pg.click('#busesBtn'); }
  await sleep(4000);
  const life = await pg.evaluate(() => { const L = window.__life; return { cars: L.cars.length, birds: L.birds.length, walkers: L.walkers.length, on: L.on }; });
  ok('life: 300+ cars, 150+ birds, walkers, on', life.cars >= 300 && life.birds >= 150 && life.walkers > 0 && life.on, JSON.stringify(life));
  const bd = await pg.evaluate(() => window.__ttBuses._debug());
  ok('buses: 100+ running in demo, some drawn here', bd.active >= 100 && bd.drawn > 0, `active ${bd.active}, drawn ${bd.drawn}`);
  // cars over 30 s (every 0.25 s): brief touches at junctions are a known limitation; what must never happen is a car
  // stuck inside a bus or overlapping another car (a deadlock), so the check is the LONGEST overlap per car (< 2 s),
  // plus sane speeds and cars that move
  const r7 = await pg.evaluate(async () => {
    const V = await import('./vehicles.js'); const MPX = 300 / 2048, sleep = ms => new Promise(r => setTimeout(r, ms));
    const runBus = new Map(), runCar = new Map(); let longBus = 0, longCar = 0, maxV = 0; const first = new Map();
    for (let t = 0; t < 120; t++) {
      const cs = V.carsNow, bs = V.busesNow, inB = new Set(), inC = new Set();
      for (const A of cs) {
        if (t === 0) first.set(A, [A.u, A.v]);
        maxV = Math.max(maxV, A.v_mps || 0);
        for (const B of bs) { const dx = (A.u - B.u) * MPX, dy = (A.v - B.v) * MPX; if (Math.abs(dx * B.hx + dy * B.hy) < 6 && Math.abs(-dx * B.hy + dy * B.hx) < 1.2) inB.add(A); }
      }
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const A = cs[i], B = cs[j], dx = (B.u - A.u) * MPX, dy = (B.v - A.v) * MPX;
        if (Math.abs(dx * A.hx + dy * A.hy) < 3.5 && Math.abs(-dx * A.hy + dy * A.hx) < 1.2) { inC.add(A); inC.add(B); }
      }
      for (const A of cs) {
        const b = inB.has(A) ? (runBus.get(A) || 0) + 1 : 0, c = inC.has(A) ? (runCar.get(A) || 0) + 1 : 0;
        runBus.set(A, b); runCar.set(A, c); longBus = Math.max(longBus, b); longCar = Math.max(longCar, c);
      }
      await sleep(250);
    }
    let moved = 0; for (const [A, p] of first) if (Math.hypot(A.u - p[0], A.v - p[1]) * MPX > 5) moved++;
    return { longBusS: longBus / 4, longCarS: longCar / 4, maxKmh: Math.round(maxV * 3.6), moved, cars: first.size };
  });
  ok('cars: no car stuck in a bus or another car (>2 s), <= 70 km/h, most move', r7.longBusS <= 2 && r7.longCarS <= 2 && r7.maxKmh <= 70 && r7.moved > r7.cars * 0.5, JSON.stringify(r7));
  // clipping: no drawn bus / ground-life pixel off the painting (migrants fly, so they're lifted out during the check)
  const clip = () => pg.evaluate(async () => {
    const V = await import('./vehicles.js'); const it = window.__tt.viewer.world.getItemAt(0), o = { on: 0, off: 0 };
    const fl = window.__life.migrants.flocks, saved = fl.splice(0); await new Promise(r => setTimeout(r, 400));
    for (const cls of ['buses-layer', 'life-layer']) {
      const c = document.querySelector('canvas.' + cls), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = c.width / c.clientWidth;
      for (let y = 0; y < c.height; y += 3) for (let x = 0; x < c.width; x += 3) {
        if (d[(y * c.width + x) * 4 + 3] < 40) continue;
        const p = it.viewerElementToImageCoordinates(new OpenSeadragon.Point(x / s, y / s));
        V.isPainted(p.x + window.__tt.origin[0], p.y + window.__tt.origin[1]) ? o.on++ : o.off++;
      }
    }
    fl.push(...saved); return o;
  });
  const c0 = await clip(); ok('clip: centre draws on the painting', c0.on > 0 && c0.off === 0, JSON.stringify(c0));
  for (const [u, v, z, n] of [[32014, 4704, 0.25, 'east'], [-26677, -34000, 0.2, 'north'], [-9915, 24000, 0.2, 'south'], [-40000, -8000, 0.25, 'west']]) {
    await pg.evaluate((u, v, z) => { const o = window.__tt.origin, [lat, lon] = window.__tt.toLatLon(u - o[0], v - o[1]); window.__tt.go(lat, lon, z, true); }, u, v, z);
    await sleep(3000); const c = await clip(); ok(`clip: nothing drawn off the painting (${n} edge)`, c.off === 0, JSON.stringify(c));
  }
  // tilt-shift: 4 blur bands when on, hidden when off
  const bands = await pg.$$eval('.tilt .ts', l => l.map(e => getComputedStyle(e).backdropFilter).filter(f => f && f !== 'none').length);
  await pg.click('#tsBtn'); await sleep(300); const hid = await pg.$eval('.tilt', e => e.hidden); await pg.click('#tsBtn');
  ok('tilt-shift: 4 blur bands, hidden when off', bands === 4 && hid, `bands ${bands}, hidden ${hid}`);
  // no cloud OVERLAY over the painting (removed on request); the cloud sea is only #map's background around the island
  ok('no cloud overlay (clouds only behind the map)', await pg.evaluate(() => !performance.getEntriesByType('resource').some(r => /atmosphere|cloud(?!s\.(avif|webp))/i.test(r.name))
    && !document.querySelector('[class*=cloud]') && /clouds\.(avif|webp)/.test(getComputedStyle(document.getElementById('map')).backgroundImage)));
  ok('live layers: no errors', !errs.length && !bad.length, [...errs, ...bad].slice(0, 3).join(' | '));
  await pg.close();
}
{ // atlas: every map in maps.json is listed and every thumbnail loads
  const pg = await b.newPage(); const bad = []; pg.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await pg.goto(BASE.replace('app/index.html', 'world/index.html'), { waitUntil: 'networkidle2' }); await sleep(800);
  const r = await pg.evaluate(async () => {
    const m = await (await fetch('maps.json')).json(), L = Array.isArray(m) ? m : m.maps;
    const st = await Promise.all(L.filter(x => x.thumb).map(x => fetch(x.thumb, { method: 'HEAD' }).then(r => r.status)));
    return { n: L.length, thumbs: st.length, thumbsOk: st.filter(s => s === 200).length, ours: L.some(x => x.ours) };
  });
  ok('atlas: maps listed, all thumbnails load', r.n >= 50 && r.thumbs === r.thumbsOk && r.ours && !bad.length, JSON.stringify(r) + (bad.length ? ' ' + bad[0] : ''));
  await pg.close();
}
await b.close();
const fails = results.filter(x => !x).length;
console.log(`\n${results.length - fails}/${results.length} checks passed; screenshots in ${path.relative(UNIT, SHOTS)}`);
process.exit(fails ? 1 : 0);
