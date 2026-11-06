// Follow a bus through a dense block and capture it visible, hidden (x-ray) and visible again; then check Stop and Esc.
// node render/sprites/test_bus_follow.mjs [lat,lon,zoom] [HH:MM]
import puppeteer from 'puppeteer-core';
const [spot = '41.3205,19.8105,0.55', time = '08:10'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('requestfailed', r => !r.url().includes('open-meteo') && errors.push('failed ' + r.url()));
await p.goto(`http://127.0.0.1:8766/app/?lang=en&buses=${time}#${spot}`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__ttBuses?._debug().active > 0, { timeout: 20000 }); await new Promise(r => setTimeout(r, 1500));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dbg = () => p.evaluate(() => window.__ttBuses._debug());
// a visible bus away from the UI
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  target = await p.evaluate(() => window.__ttBuses._debug().buses.find(([x, y]) => x > 120 && y > 150 && x < 1250 && y < 760 && document.elementFromPoint(x, y)?.closest('.openseadragon-canvas')));
  if (!target) await sleep(1000);
}
if (!target) { console.log('no bus in view'); await b.close(); process.exit(1); }
await p.mouse.click(target[0], target[1] - 4); await sleep(400);
await p.click('.bus-follow'); await sleep(1500);
console.log('following:', await p.$eval('#followChip', e => e.hidden ? 'HIDDEN' : e.innerText.replace(/\n/g, ' | ')), JSON.stringify((await dbg()).followed));
await p.screenshot({ path: 'data/shots/buses_follow_1_visible.png' });
let phase = 'visible', t0 = Date.now();
while (Date.now() - t0 < 150000 && phase !== 'done') {
  await sleep(700); const f = (await dbg()).followed; if (!f) { console.log('follow ended (trip over?)'); break; }
  if (phase === 'visible' && f.alpha === 0) { await sleep(300); await p.screenshot({ path: 'data/shots/buses_follow_2_hidden.png' }); phase = 'hidden'; console.log('hidden at', ((Date.now() - t0) / 1000).toFixed(0), 's', JSON.stringify(f),
    'tip:', await p.evaluate(() => { const t = document.querySelector('.bus-tip'); return t.hidden || t.style.visibility === 'hidden' ? 'HIDDEN' : 'shown'; })); }
  else if (phase === 'hidden' && f.alpha === 1) { await sleep(300); await p.screenshot({ path: 'data/shots/buses_follow_3_visible_again.png' }); phase = 'done'; console.log('visible again at', ((Date.now() - t0) / 1000).toFixed(0), 's'); }
}
console.log('phase reached:', phase);
// Stop button on the chip
await p.click('#followChip button'); await sleep(500);
console.log('after Stop: chip', await p.$eval('#followChip', e => e.hidden), 'followed', JSON.stringify((await dbg()).followed));
// follow again, then Esc
const again = await p.evaluate(() => window.__ttBuses._debug().buses.find(([x, y]) => x > 120 && y > 150 && x < 1250 && y < 760 && document.elementFromPoint(x, y)?.closest('.openseadragon-canvas')));
if (again) { await p.mouse.click(again[0], again[1] - 4); await sleep(400); await p.click('.bus-follow'); await sleep(800);
  console.log('re-follow chip shown:', await p.$eval('#followChip', e => !e.hidden));
  await p.keyboard.press('Escape'); await sleep(500);
  console.log('after Esc: chip hidden', await p.$eval('#followChip', e => e.hidden), 'followed', JSON.stringify((await dbg()).followed)); }
console.log('errors', errors); await b.close();
