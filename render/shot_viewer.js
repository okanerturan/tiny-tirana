// Screenshot the viewer: node shot_viewer.js URL OUT.png [W H]
const puppeteer = require('puppeteer-core');
(async () => {
  const [url, out, w = 1280, h = 800] = process.argv.slice(2);
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const p = await b.newPage(); await p.setViewport({ width: +w, height: +h });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(url, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: out }); console.log('saved', out, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no errors');
  await b.close();
})();
