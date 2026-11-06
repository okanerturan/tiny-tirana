// Lines menu test: node render/sprites/test_bus_lines.mjs [WxH] [mobile] [line]
import puppeteer from 'puppeteer-core';
const [size = '1400x900', mobile = '', line = '2'] = process.argv.slice(2), [w, h] = size.split('x').map(Number), tag = mobile ? 'phone' : 'desk';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('requestfailed', r => errors.push('failed ' + r.url()));
p.on('console', m => m.type() === 'error' && errors.push(m.text()));
await p.goto(`http://127.0.0.1:8766/app/?lang=en#41.3262,19.8196,0.3`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__ttBuses);
await p.click('#busesBtn'); await p.waitForFunction(() => !document.querySelector('#busesChip .lines').hidden, { timeout: 20000 });
if (!(await p.evaluate(() => document.querySelector('.bus-lines').matches(':popover-open')))) await p.click('#busesChip .lines');
await new Promise(r => setTimeout(r, 400));
if (await p.evaluate(() => !document.querySelector('#busesChip button:not(.lines)').hidden && document.querySelector('#busesChip button:not(.lines)').textContent.includes('demo')))
  await p.evaluate(() => document.querySelector('#busesChip button:not(.lines)').click());
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: `data/shots/buses_lines_${tag}_menu.png` });
await p.type('.bl-filter', line); await new Promise(r => setTimeout(r, 200));
const rows = await p.$$eval('.bl-row:not([hidden]) .bus-badge', e => e.map(x => x.textContent)); console.log('filter', line, '->', rows.join(' '));
await p.evaluate(l => [...document.querySelectorAll('.bl-row:not([hidden])')].find(li => li.querySelector('.bus-badge').textContent === l).querySelector('button').click(), line);
await new Promise(r => setTimeout(r, 2500));
console.log(await p.evaluate(() => ({ chip: document.querySelector('#busesChip').innerText.replace(/\n/g, ' | '), detail: document.querySelector('.bl-detail:not([hidden])')?.innerText.replace(/\n/g, ' | '),
  drawn: window.__ttBuses._debug().buses.map(b => b[2]).join(','), attr: document.querySelector('.attr').innerText })));
await p.screenshot({ path: `data/shots/buses_lines_${tag}_line.png` });
console.log('errors', errors); await b.close();
