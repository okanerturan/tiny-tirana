// Tap a stop hidden behind a building: node render/sprites/test_bus_stop_tap.mjs LINE lat,lon,zoom out.png [WxH] [mobile]
import puppeteer from 'puppeteer-core';
const [line, spot, out, size = '1400x900', mobile = ''] = process.argv.slice(2), [w, h] = size.split('x').map(Number), [lat, lon, zoom] = spot.split(',').map(Number);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('requestfailed', r => errors.push('failed ' + r.url()));
await p.goto(`http://127.0.0.1:8766/app/?lang=en&buses=08:10#${spot}`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__ttBuses?._debug().active > 0, { timeout: 20000 });
await p.evaluate(l => { window.__ttBuses.openPanel(false); const li = [...document.querySelectorAll('.bl-row')].find(x => x.querySelector('.bus-badge')?.textContent === l); li.querySelector('button').click(); }, line);
await new Promise(r => setTimeout(r, 1200));
await p.evaluate((a, o, z) => { document.querySelector('.bus-lines').hidePopover?.(); window.__tt.go(a, o, z, true); }, lat, lon, zoom);
await new Promise(r => setTimeout(r, 2500));
const stops = await p.evaluate(() => window.__ttBuses._debug().hiddenStops.filter(([x, y]) => document.elementFromPoint(x, y)?.closest('.openseadragon-canvas')));;   // not under UI
console.log('hidden stops on screen', stops.length, stops.slice(0, 3));
if (stops.length) {
  const [x, y] = stops[0], dx = mobile ? 15 : 9;
  console.log('element at point:', await p.evaluate((x, y) => { const e = document.elementFromPoint(x, y); const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return [e.tagName, e.className, e.id, e.parentElement?.id, e.parentElement?.parentElement?.id || e.parentElement?.parentElement?.className, [r.x, r.y, r.width, r.height].map(Math.round), cs.opacity, cs.visibility, cs.pointerEvents].join(' | '); }, x + dx, y + 4));                       // tap off-centre, inside the generous target
  if (mobile) await p.touchscreen.tap(x + dx, y + 6);
  else { await p.mouse.move(x + dx, y + 4); await new Promise(r => setTimeout(r, 400));
    console.log('hover tip:', await p.evaluate(() => { const t = document.querySelector('.bus-tip'); return t.hidden ? 'HIDDEN' : t.style.visibility || 'shown'; }));
    await p.mouse.click(x + dx, y + 4); }
  await new Promise(r => setTimeout(r, 600));
  console.log('tip:', await p.evaluate(() => { const t = document.querySelector('.bus-tip'); return t.hidden || t.style.visibility === 'hidden' ? 'HIDDEN' : t.innerText.replace(/\n+/g, ' | '); }));
}
await p.screenshot({ path: out }); console.log('errors', errors); await b.close();
