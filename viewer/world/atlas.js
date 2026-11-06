// Isometric Cities Atlas: globe, the wave replay, stats and the list of maps.
import { createGlobe } from './globe.js';

const KINDS = {
  finetune: ['Trained AI', '--ft', 'A model trained on the city (usually a small LoRA) paints the whole map.'],
  imagegen: ['AI image model', '--ig', 'A ready-made image model (GPT Image, Nano Banana, Codex…) draws the tiles, with no training.'],
  code: ['Built in code', '--cd', 'Drawn live from open data or 3D models with a pixel-art look, no image AI.'],
  unknown: ['Not stated', '--un', 'The maker has not said how it was made.'],
};
const TOKENS = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v[1]]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 864e5;
const $ = id => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const norm = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = u => { try { return new URL(u, location.href).hostname.replace(/^www\./, ''); } catch { return u; } };
const cube = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 28 10.5 16 17 4 10.5Z" fill="currentColor" opacity=".55"/><path d="M4 10.5 16 17v12L4 22.5Z" fill="currentColor"/><path d="M28 10.5 16 17v12l12-6.5Z" fill="currentColor" opacity=".75"/></svg>';

const [raw, topo110] = await Promise.all([
  fetch('maps.json').then(r => r.json()),
  fetch('vendor/countries-110m.json').then(r => r.json()),
]);

// ---------- dates: exact days, or a month ("2026-08", "2026-08/09", "2026-06 →") placed mid-month ----------
function when(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:\/(\d{2}))?/.exec(s || '');
  if (!m) return null;
  const [, y, mo, d, mo2] = m;
  const t = Date.UTC(+y, +mo - 1, d ? +d : 15);
  const label = d ? `${+d} ${MON[mo - 1]}` : mo2 ? `${MON[mo - 1]}–${MON[mo2 - 1]}` : `${MON[mo - 1]}${s.includes('→') ? ' on' : ''}`;
  return { t, exact: !!d, y: +y, label, iso: d ? `${y}-${mo}-${d}` : `${y}-${mo}` };
}
const longDate = t => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const maps = raw.sort((a, b) => (b.ours ? 1 : 0) - (a.ours ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));
for (const m of maps) {
  m.kind = KINDS[m.approach] ? m.approach : 'unknown';
  m.when = when(m.date);
  m.lon = +m.lon; m.lat = +m.lat;
  m.key = norm((m.city || '').replace(/\s*\(.*?\)\s*/g, ' ')).trim() || `${m.lat.toFixed(1)},${m.lon.toFixed(1)}`;
  m.hay = norm(`${m.title} ${m.city} ${m.country} ${m.author}`);
  m.live = true;
}

// ---------- the wave's clock: every day takes a moment, every launch takes a little longer ----------
const dated = maps.filter(m => m.when);
const exact = dated.filter(m => m.when.exact);
const t0 = Math.min(...exact.map(m => m.when.t)), t1 = Math.max(...exact.map(m => m.when.t));
const D = Math.round((t1 - t0) / DAY), END = D + 1;
const yearNow = new Date(t1).getUTCFullYear();
const byTitle = t => maps.find(m => norm(m.title) === norm(t));
const first = [...exact].sort((a, b) => a.when.t - b.when.t)[0];
const london = byTitle('tiny.london');
const ours = maps.find(m => m.ours);
const featured = new Set([first, london, ours].filter(Boolean));
for (const m of dated) m.day = Math.max(0, Math.min(D, Math.round((m.when.t - t0) / DAY)));
dated.sort((a, b) => a.day - b.day || (featured.has(b) ? 1 : 0) - (featured.has(a) ? 1 : 0) || (a.ours ? 1 : 0) - (b.ours ? 1 : 0) || a.title.localeCompare(b.title));
const perDay = new Array(END).fill(0);
for (const m of dated) perDay[m.day]++;
const A = 3.6 / END, B = 7.2 / Math.max(1, dated.length);
const dur = perDay.map(n => A + B * n), T = [0];
for (let d = 0; d < END; d++) T.push(T[d] + dur[d]);
const TOTAL = T[END];
{ const seen = new Array(END).fill(0); for (const m of dated) m.at = T[m.day] + dur[m.day] * (++seen[m.day] - 0.5) / perDay[m.day]; }
for (const m of maps) if (!m.when) m.at = Infinity;
const pOf = v => { if (v >= END) return Infinity; const d = Math.floor(v); return T[d] + (v - d) * dur[d]; };
const vOf = p => { if (p >= TOTAL) return END; let d = 0; while (d < END - 1 && T[d + 1] <= p) d++; return d + (p - T[d]) / dur[d]; };
const dayLabel = v => longDate(t0 + Math.min(Math.floor(v), D) * DAY);

// ---------- globe ----------
const globeEl = $('globe');
const globe = createGlobe(globeEl, {
  kinds: TOKENS, start: [-28, 30],
  onPick: m => select(m, 'globe'),
  onHover: m => showTip(m),
  // finer (50m) coastlines only once the globe is drawn large enough to show them; phones stay on 110m
  onNeedDetail: () => fetch('vendor/countries-50m.json').then(r => r.json()).then(topo50 => {
    globe.setGeo('full', topo50);
    deriveCountries(topo50); updateStats();
  }).catch(() => {}),
});
globe.setGeo('coarse', topo110);
globe.setMaps(maps);

// countries from the coastlines themselves (some entries name none); coastal cities get a small nudge
const ALIAS = { 'United States of America': 'United States', 'Czech Rep.': 'Czechia', 'Bosnia and Herz.': 'Bosnia and Herzegovina' };
let countriesKnown = false;
function deriveCountries(topo) {
  const feats = window.topojson.feature(topo, topo.objects.countries).features
    .map(f => ({ f, b: window.d3.geoBounds(f), name: f.properties?.name }));
  const inBox = ([x, y], [[x0, y0], [x1, y1]]) => y >= y0 - 0.5 && y <= y1 + 0.5 && (x0 <= x1 ? x >= x0 - 0.5 && x <= x1 + 0.5 : x >= x0 - 0.5 || x <= x1 + 0.5);
  const find = p => feats.find(c => inBox(p, c.b) && window.d3.geoContains(c.f, p))?.name;
  const nudges = [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]];
  for (const m of maps) {
    let name = null;
    for (const [dx, dy] of nudges) if ((name = find([m.lon + dx, m.lat + dy]))) break;
    m.countryName = ALIAS[name] || name || m.country || null;
    const el = items.get(m)?.querySelector('.country');
    if (el && !m.country && m.countryName) el.textContent = `, ${m.countryName}`;
  }
  countriesKnown = true;
}

// ---------- state ----------
let filter = 'all', query = '', current = null;
let pNow = Infinity, showUndated = true;
const timeOK = m => (m.at === Infinity ? showUndated : m.at <= pNow);
const filterOK = m => (filter === 'all' || m.kind === filter) && (!query || m.hay.includes(query));
const refreshShown = () => globe.setShown(m => m.live && filterOK(m));

// ---------- chips, search and the list ----------
const chips = $('chips'), list = $('list'), items = new Map();
const countOf = k => maps.filter(m => k === 'all' || m.kind === k).length;
for (const k of ['all', 'finetune', 'imagegen', 'code']) {
  const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.dataset.k = k;
  if (k !== 'all') { b.style.setProperty('--c', `var(${KINDS[k][1]})`); b.title = KINDS[k][2]; }
  b.innerHTML = `${k === 'all' ? '' : '<i></i>'}${k === 'all' ? 'All maps' : KINDS[k][0]} <b>${countOf(k)}</b>`;
  b.addEventListener('click', () => { filter = k; applyFilter(); });
  chips.append(b);
}
$('q').addEventListener('input', e => { query = norm(e.target.value.trim()); applyFilter(); });
$('q').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; query = ''; applyFilter(); } });

const thumbHtml = (m, cls = 'thumb', size = 64) => m.thumb
  ? `<img class="${cls}" src="${esc(m.thumb)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`
  : `<span class="${cls} ph" aria-hidden="true">${cube}</span>`;
const dateHtml = m => m.when ? `<time datetime="${m.when.iso}">${esc(m.when.label)}${m.when.y !== yearNow ? ` ${m.when.y}` : ''}</time>` : '';

for (const m of maps) {
  const li = document.createElement('li'); li.className = 'item';
  li.style.setProperty('--c', `var(${m.ours ? '--accent' : KINDS[m.kind][1]})`);
  li.innerHTML = `<details name="atlas"><summary>${thumbHtml(m)}
      <span class="row1"><span class="t">${esc(m.title)}</span>${m.ours ? '<span class="tag">ours</span>' : ''}${m.wip ? '<span class="tag soft">in progress</span>' : ''}${dateHtml(m)}</span>
      <span class="sub"><span class="kind"><span>${esc(m.city)}<span class="country">${m.country ? ', ' + esc(m.country) : ''}</span></span></span>${m.author ? ' · ' + esc(m.author) : ''}</span>
    </summary>
    <div class="more"><p>${esc(m.desc)}</p><p class="how"><b>${KINDS[m.kind][0]}.</b> ${KINDS[m.kind][2]}</p>
      <div class="links"><a class="go" href="${esc(m.url)}" target="_blank" rel="noopener">Visit ${esc(host(m.url))} ↗</a>${m.howto ? `<a href="${esc(m.howto)}" target="_blank" rel="noopener">How it was made ↗</a>` : ''}</div></div>
  </details>`;
  const d = li.firstElementChild;
  d.addEventListener('toggle', () => {
    if (d.open) { if (current !== m) select(m, 'list'); }
    else if (current === m) select(null, 'list');
  });
  li.addEventListener('pointerenter', () => { if (fine.matches) globe.highlight(m); });
  li.addEventListener('pointerleave', () => { if (fine.matches) globe.highlight(null); });
  items.set(m, li); list.append(li);
}
const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No maps match that yet. Maybe your city is next?'; empty.hidden = true;
list.append(empty);
// arrow keys walk the cards
list.addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key) || e.target.tagName !== 'SUMMARY') return;
  const sums = [...list.querySelectorAll('.item:not([hidden]) summary')];
  const next = sums[sums.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)];
  if (next) { e.preventDefault(); next.focus(); }
});

function applyFilter() {
  for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.k === filter));
  let n = 0;
  for (const [m, li] of items) { const on = filterOK(m); li.hidden = !on; n += on; }
  empty.hidden = n > 0;
  $('count').textContent = n === maps.length ? `${n}` : `${n} of ${maps.length}`;
  if (current && !filterOK(current)) select(null);
  refreshShown();
}

// ---------- selection: list, globe and callout agree ----------
const callout = globeEl.querySelector('.callout-in'), tip = globeEl.querySelector('.tip-in');
function select(m, from = 'api') {
  if (m === current) return;
  current = m;
  if (m) {
    if (playing) stop();
    if (!m.live) setTime(END);
    if (!filterOK(m)) { filter = 'all'; query = ''; $('q').value = ''; applyFilter(); }
    const li = items.get(m), d = li.firstElementChild;
    if (!d.open) d.open = true;
    callout.style.setProperty('--c', `var(${m.ours ? '--accent' : KINDS[m.kind][1]})`);
    callout.innerHTML = `${thumbHtml(m, '', 44)}<div><b>${esc(m.title)}</b><span>${esc(m.city)} · ${KINDS[m.kind][0]}</span></div>
      <a href="${esc(m.url)}" target="_blank" rel="noopener" tabindex="-1">Visit ${esc(host(m.url))} ↗</a>`;
    if (from !== 'list') revealCard(li);
  } else {
    for (const li of items.values()) if (li.firstElementChild.open) li.firstElementChild.open = false;
  }
  if (m) { clearTimeout(capTimer); clearTimeout(finishTimer); capEl.dataset.show = 'false'; }
  globe.select(m, { fly: !!m });
  hint(true);
}
// scroll the card into view only where the list scrolls on its own (side panel), never the whole page
function revealCard(li) {
  if (list.scrollHeight <= list.clientHeight + 1 || getComputedStyle(list).overflowY === 'visible') return;
  requestAnimationFrame(() => {
    const top = li.offsetTop - 8, bottom = li.offsetTop + li.offsetHeight + 8;
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;
    list.scrollTo({ top: top - list.clientHeight * 0.2, behavior: reduce.matches ? 'auto' : 'smooth' });
  });
}
function showTip(m) {
  if (!m) return;
  const here = m.stack.items.length;
  tip.innerHTML = `${esc(m.title)} <small>· ${esc(m.city)}${here > 1 ? ` · ${here} maps here` : ''}</small>`;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current && e.target.id !== 'q') select(null); });

// ---------- stats strip (follows the wave) ----------
const legend = $('legend'), bar = $('bar');
for (const k of Object.keys(KINDS)) {
  if (!countOf(k)) continue;
  const li = document.createElement('li'); li.dataset.k = k; li.style.setProperty('--c', `var(${KINDS[k][1]})`);
  li.innerHTML = `<b>${KINDS[k][0]}</b><span class="n">0</span><small>${KINDS[k][2]}</small>`;
  legend.append(li);
  const s = document.createElement('span'); s.dataset.k = k; s.style.setProperty('--c', `var(${KINDS[k][1]})`); bar.append(s);
}
const setText = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
function updateStats() {
  const live = maps.filter(m => m.live);
  setText($('n-maps'), live.length);
  setText($('n-cities'), new Set(live.map(m => m.key)).size);
  setText($('n-countries'), countriesKnown ? new Set(live.map(m => m.countryName).filter(Boolean)).size : '–');
  const parts = [];
  for (const k of Object.keys(KINDS)) {
    const n = live.filter(m => m.kind === k).length;
    const seg = bar.querySelector(`[data-k="${k}"]`); if (!seg) continue;
    seg.style.setProperty('--w', `calc(${(n / maps.length) * 100}% - 2px)`);
    seg.hidden = !n;
    setText(legend.querySelector(`[data-k="${k}"] .n`), n);
    if (n) parts.push(`${n} ${KINDS[k][0].toLowerCase()}`);
  }
  if (!playing) bar.setAttribute('aria-label', parts.join(', '));
}

// ---------- the wave: launches per week, month ticks, play and scrub ----------
const scrub = $('scrub'), bars = $('bars'), months = $('months'), dateOut = $('wave-date'), playBtn = $('play');
scrub.max = String(END); scrub.value = String(END);
const weekBars = [];
{
  const nb = Math.ceil(END / 7), bins = Array.from({ length: nb }, () => ({}));
  for (const m of dated) { const b = bins[Math.floor(m.day / 7)]; b[m.kind] = (b[m.kind] || 0) + 1; }
  const tot = b => Object.values(b).reduce((a, c) => a + c, 0), max = Math.max(...bins.map(tot));
  bins.forEach((b, i) => {
    const n = tot(b); if (!n) return;
    const el = document.createElement('span'); el.className = 'hb on';
    el.style.cssText = `--x:${(i * 7) / END};--wd:${Math.min(7, END - i * 7) / END};--h:${n / max}`;
    el.innerHTML = Object.keys(KINDS).filter(k => b[k]).map(k => `<i style="--n:${b[k]};--c:var(${KINDS[k][1]})"></i>`).join('');
    el.dataset.from = String(i * 7);
    bars.append(el); weekBars.push(el);
  });
  const d0 = new Date(t0);
  for (let y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1; ; mo++) {
    const t = Date.UTC(y, mo, 1); if (t > t1) break;
    const x = (t - t0) / DAY / END; if (x > 0.97) break;
    const s = document.createElement('span'); s.style.setProperty('--x', x); s.textContent = MON[new Date(t).getUTCMonth()]; months.append(s);
  }
  const s = document.createElement('span'); s.style.setProperty('--x', 0); s.textContent = `${new Date(t0).getUTCDate()} ${MON[new Date(t0).getUTCMonth()]}`;
  months.prepend(s);
  while (months.children[1] && +months.children[1].style.getPropertyValue('--x') < 0.14) months.children[1].remove(); // room for the start date
}
// click or drag on the bars scrubs too
bars.addEventListener('pointerdown', e => {
  const r = bars.getBoundingClientRect(), to = x => setTime(Math.max(0, Math.min(1, (x - r.left) / r.width)) * END, true);
  to(e.clientX); bars.setPointerCapture(e.pointerId);
  const mv = ev => to(ev.clientX), up = () => { bars.removeEventListener('pointermove', mv); bars.removeEventListener('pointerup', up); };
  bars.addEventListener('pointermove', mv); bars.addEventListener('pointerup', up);
});

let sliderV = END;
function updateWave() {
  const v = sliderV;
  if (document.activeElement !== scrub || playing) scrub.value = String(v);
  bars.style.setProperty('--p', String(Math.min(1, v / END)));
  for (const el of weekBars) el.classList.toggle('on', +el.dataset.from < v);
  const live = maps.reduce((n, m) => n + m.live, 0);
  setText(dateOut, v >= END ? `Up to ${longDate(t1)}` : dayLabel(v));
  scrub.setAttribute('aria-valuetext', `${v >= END ? 'All maps, up to ' + longDate(t1) : dayLabel(v)}: ${live} maps`);
}

// make the maps visible at the current clock; new ones pop in when asked
let camVec = null, camAt = 0;
const unitOf = m => { const l = m.lon * Math.PI / 180, p = m.lat * Math.PI / 180; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
function applyTime({ animate = false } = {}) {
  const now = performance.now(), fresh = [];
  for (const m of maps) {
    const on = timeOK(m);
    if (on && !m.live) { m.live = true; fresh.push(m); }
    else if (!on && m.live) { m.live = false; m.popAt = 0; }
  }
  refreshShown();
  if (animate && fresh.length && fresh.length <= 24) {
    fresh.forEach((m, i) => globe.pop(m, now + i * 70));
    if (playing && !reduce.matches) {
      // the camera drifts toward where things are happening lately
      const k = Math.exp(-(now - camAt) / 1600); camAt = now;
      const v = camVec ? camVec.map(c => c * k) : [0, 0, 0];
      for (const m of fresh) unitOf(m).forEach((c, i) => { v[i] += c; });
      camVec = v;
      const lon = Math.atan2(v[1], v[0]) * 180 / Math.PI, lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180 / Math.PI;
      globe.follow([lon, lat * 0.75], 1.05);
    }
  }
  updateStats(); updateWave();
}
function setTime(v, fromUser = false) {
  if (fromUser && playing) pause();
  sliderV = Math.max(0, Math.min(END, v));
  if (sliderV >= END - 1e-6) { sliderV = END; pNow = Infinity; showUndated = true; }
  else { pNow = pOf(sliderV); showUndated = false; }
  const before = maps.reduce((n, m) => n + m.live, 0);
  applyTime({ animate: fromUser && !reduce.matches });
  if (fromUser && before !== maps.reduce((n, m) => n + m.live, 0)) hint(true);
}
scrub.addEventListener('input', () => setTime(+scrub.value, true));

// ---------- captions at the moments that mattered ----------
const capEl = $('caption');
let capTimer = 0, finishTimer = 0;
function caption(title, text = '', ms = 2800) {
  clearTimeout(capTimer);
  capEl.innerHTML = `<strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}`;
  capEl.dataset.show = 'true';
  capTimer = setTimeout(() => { capEl.dataset.show = 'false'; }, ms);
}
const moments = [];
if (first) moments.push({ m: first, at: first.at, hold: 1300, title: `It starts in ${first.city}`, text: `${first.title}${first.author ? ', by ' + first.author : ''}` });
{
  const summer = dated.filter(m => m.at > first.at + 1e-6 && (!london || m.at < london.at) && m.when.t >= Date.UTC(yearNow, 6, 1));
  const cities = [...new Set(summer.map(m => m.city.replace(/\s*\(.*?\)/, '')))].slice(0, 3);
  if (summer.length >= 2) moments.push({ m: summer[0], at: summer[0].at, hold: 700, title: 'A few brave copies', text: `${cities.join(', ')} give it a go` });
}
if (london) moments.push({ m: london, at: london.at, hold: 1400, title: 'tiny.london opens the floodgates', text: 'Dozens of cities follow within two weeks' });
{
  let best = -1, bestN = 0;
  perDay.forEach((n, d) => { if ((!london || d > london.day) && n > bestN) { best = d; bestN = n; } });
  if (bestN >= 4) {
    const day = dated.filter(m => m.day === best);
    moments.push({ at: day[0].at, hold: 500, title: `${bestN} new maps in one day`, text: `${dayLabel(best)}: ${[...new Set(day.map(m => m.city.replace(/\s*\(.*?\)/, '')))].join(', ')}` });
  }
}
if (ours && ours.when) moments.push({ m: ours, at: ours.at, hold: 1300, title: `${ours.title} joins in`, text: `${ours.city}, ${ours.country}. That one is ours` });
moments.sort((a, b) => a.at - b.at);

// ---------- playback ----------
let playing = false, ph = 0, holdUntil = 0, lastTick = 0, rafId = 0;
const undated = maps.filter(m => !m.when);
function setPlaying(on, label) {
  playing = on;
  playBtn.toggleAttribute('data-playing', on);
  $('play-label').textContent = label ?? (on ? 'Pause' : 'Play the wave');
}
function play() {
  select(null);
  if (pNow === Infinity || ph >= TOTAL) {
    ph = 0; showUndated = false; pNow = -1; camVec = null;
    applyTime();
    globe.flyTo(first.lon, first.lat - 6, 1.05, 900);
    holdUntil = performance.now() + (reduce.matches ? 200 : 950);
  } else {
    ph = pNow; holdUntil = 0;
  }
  setPlaying(true);
  globe.setAuto(false);
  hint(true);
  lastTick = performance.now();
  rafId = requestAnimationFrame(tick);
}
// stop the replay and go back to the full atlas
function stop() {
  cancelAnimationFrame(rafId);
  setPlaying(false);
  clearTimeout(capTimer); clearTimeout(finishTimer); capEl.dataset.show = 'false';
  globe.follow(null); globe.setAuto(true);
  ph = TOTAL; setTime(END);
}
function pause() {
  cancelAnimationFrame(rafId);
  setPlaying(false, ph > 0 && ph < TOTAL ? 'Keep playing' : undefined);
  globe.follow(null); globe.setAuto(true);
}
function tick(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  if (now >= holdUntil) {
    const prev = ph; ph = Math.min(TOTAL, ph + dt);
    for (const mo of moments) if (mo.at > prev && mo.at <= ph) {
      ph = mo.at; holdUntil = now + (reduce.matches ? mo.hold + 600 : mo.hold); caption(mo.title, mo.text, mo.hold + 1400);
      if (mo.m && !reduce.matches) { camVec = unitOf(mo.m).map(c => c * 3); camAt = now; globe.follow([mo.m.lon, mo.m.lat * 0.75 - 3], 1.08); }
      break;
    }
  }
  pNow = ph; sliderV = Math.min(vOf(ph), END - 1e-3);
  applyTime({ animate: true });
  if (ph >= TOTAL && now >= holdUntil) return finish();
  rafId = requestAnimationFrame(tick);
}
function finish() {
  setPlaying(false, 'Play again');
  globe.follow(null);
  const cities = () => new Set(maps.map(m => m.key)).size;
  const done = () => {
    sliderV = END; pNow = Infinity; showUndated = true; applyTime({ animate: true });
    caption(`${maps.length} maps in ${cities()} cities, and counting`, 'Is your city next?', 4200);
    globe.setAuto(true);
  };
  if (undated.length) {
    caption(`Plus ${undated.length} we couldn't put a date on`, '', 1800);
    showUndated = true; applyTime({ animate: true });
    finishTimer = setTimeout(done, 1700);
  } else done();
}
playBtn.addEventListener('click', () => (playing ? pause() : play()));

// ---------- a hint that leaves once people get it ----------
const hintEl = $('hint');
hintEl.textContent = fine.matches ? 'Drag to spin · scroll to zoom · click a block' : 'Drag to spin · pinch to zoom · tap a block';
function hint(done) { if (done) hintEl.dataset.done = ''; }
globeEl.addEventListener('pointerdown', () => hint(true), { once: true });

// ---------- go ----------
$('lede-n').textContent = String(maps.length);
applyFilter();
deriveCountries(topo110);
updateStats(); updateWave();
// first visit: the blocks drop in, oldest first
if (!reduce.matches) {
  const now = performance.now() + 250;
  [...dated, ...undated].forEach((m, i) => globe.pop(m, now + i * 26));
}
window.__atlas = { maps, select, globe };


