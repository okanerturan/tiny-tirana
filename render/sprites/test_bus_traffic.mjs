// Bus car-following test: drops a stopped fake car into vehicles.js carsNow just ahead of a visible bus, checks the bus
// queues behind it (growing lag), then removes it and checks the bus catches up. node render/sprites/test_bus_traffic.mjs [spot]
import puppeteer from 'puppeteer-core';
const [spot = '41.3205,19.8195,0.8'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.goto(`http://127.0.0.1:8766/app/?lang=en&buses=${process.env.T || "demo"}#${spot}`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__ttBuses?._debug().active > 0, { timeout: 20000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bus = null;
for (let i = 0; i < 60 && !bus; i++) { bus = await p.evaluate(() => window.__ttBuses._debug().buses.find(b => b[0] > 100 && b[0] < 1250 && b[1] > 120 && b[1] < 780)); if (!bus) await sleep(1000); }
if (!bus) { console.log('no visible bus'); await b.close(); process.exit(1); }
const key = bus[3]; console.log('bus', bus[2], key);
const get = () => p.evaluate(k => window.__ttBuses._debug().buses.find(b => b[3] === k) || null, key);
// a stopped car 25 m ahead in the bus's lane (camera px; 1 m along the heading ~ 1/MPP px in the screen plane, roughly)
await p.evaluate(([, , , , u, v, hx, hy]) => import('./vehicles.js').then(V => {
  const MPP = 300 / 2048, d = 25 / MPP * 0.85;
  window.__fakeCar = { u: u + hx * d, v: v + hy * d, hx, hy, len: 4.5 / MPP, v_mps: 0 };
  window.__keep = setInterval(() => { if (!V.carsNow.includes(window.__fakeCar)) V.carsNow.push(window.__fakeCar); }, 16);
}), bus);
for (let i = 0; i < 6; i++) { await sleep(2000); const s = await get(); if (s) console.log(`t+${2 * i + 2}s lag ${s[8]} s, behind timetable ${s[9]} m, dist to car`, await p.evaluate(([u, v]) => Math.hypot(window.__fakeCar.u - u, window.__fakeCar.v - v).toFixed(0) + ' px', [s[4], s[5]])); }
await p.screenshot({ path: 'data/shots/buses_traffic_queue.png' });
await p.evaluate(() => import('./vehicles.js').then(V => { clearInterval(window.__keep); V.carsNow.length = 0; }));
for (let i = 0; i < 6; i++) { await sleep(2000); const s = await get(); if (s) console.log(`cleared +${2 * i + 2}s: behind timetable ${s[9]} m`); }
console.log('errors', errors); await b.close();
