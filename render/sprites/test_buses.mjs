// Smoke test for the Buses layer: node render/sprites/test_buses.mjs [query] [hash] [out.png] [WxH]
// Toggles the layer, checks errors / failed requests, taps a bus, screenshots.
import puppeteer from 'puppeteer-core';
const [query = 'buses=demo', hash = '41.3262,19.8196,0.45', out = 'data/shots/buses_test.png', size = '1400x900', mobile = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile });
const errors = [];
p.on('pageerror', e => errors.push('pageerror ' + e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
p.on('requestfailed', r => errors.push('failed ' + r.url()));
p.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
await p.goto(`http://127.0.0.1:8766/app/?${query}#${hash}`, { waitUntil: 'networkidle0', timeout: 60000 });
await p.waitForFunction(() => window.__ttBuses, { timeout: 20000 });
if (!query.includes('buses')) { await p.click('#busesBtn'); }
await p.waitForFunction(() => window.__ttBuses._debug().active > 0 || document.querySelector('#busesChip .txt')?.textContent.includes('No'), { timeout: 20000 });
if (process.env.COMPARE) { await p.click('#compareBtn'); await new Promise(r => setTimeout(r, 4000)); }
await new Promise(r => setTimeout(r, 2500));
const dbg = await p.evaluate(() => ({ ...window.__ttBuses._debug(), chip: document.querySelector('#busesChip').innerText, pressed: document.getElementById('busesBtn').getAttribute('aria-pressed') }));
console.log(JSON.stringify(dbg));
// tap the bus nearest the centre, check the tooltip
const bus = await p.evaluate((w, h) => { const l = window.__ttBuses._debug().buses.filter(b => b[1] > 130 && b[1] < h - 130 && b[0] < w - 90); l.sort((a, b) => Math.hypot(a[0] - w / 2, a[1] - h / 2) - Math.hypot(b[0] - w / 2, b[1] - h / 2)); return l[0]; }, w, h);
if (bus && !process.env.NOTAP) {
  if (mobile) await p.touchscreen.tap(bus[0], bus[1] - 4); else await p.mouse.click(bus[0], bus[1] - 4);
  await new Promise(r => setTimeout(r, 400));
  console.log('tip', bus, await p.evaluate(() => { const t = document.querySelector('.bus-tip'); return t.hidden ? 'HIDDEN' : t.innerText.replace(/\n/g, ' | '); }));
}
await p.screenshot({ path: out });
// CPU: measure frame time of draw over 3 s
const perf = await p.evaluate(async () => {
  const t0 = performance.now(); let frames = 0; await new Promise(r => { const f = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  return { fps: frames / 3 };
});
const m = await p.metrics(); console.log(JSON.stringify({ perf, heapMB: (m.JSHeapUsedSize / 1e6).toFixed(1), scriptS: m.ScriptDuration.toFixed(2), taskS: m.TaskDuration.toFixed(2) }));
console.log('errors', errors.length ? errors : 'none');
await b.close();
