// Screenshot one selected bus line at a given spot: node render/sprites/shot_bus_line.mjs LINE lat,lon,zoom out.png [HH:MM]
import puppeteer from 'puppeteer-core';
const [line, spot, out, time = '08:10'] = process.argv.slice(2), [lat, lon, zoom] = spot.split(',').map(Number);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('requestfailed', r => errors.push('failed ' + r.url()));
await p.goto(`http://127.0.0.1:8766/app/?lang=en&buses=${time}#${spot}`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__ttBuses?._debug().active > 0, { timeout: 20000 });
await p.evaluate(l => { const B = window.__ttBuses; B.openPanel(false);
  const li = [...document.querySelectorAll('.bl-row')].find(x => x.querySelector('.bus-badge')?.textContent === l); li.querySelector('button').click(); }, line);
await new Promise(r => setTimeout(r, 1500));
await p.evaluate((a, o, z) => window.__tt.go(a, o, z, true), lat, lon, zoom);
await p.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {}); await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: out }); console.log('errors', errors); await b.close();
