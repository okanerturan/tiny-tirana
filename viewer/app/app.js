// Tiny Tirana viewer. No framework, no build step. Map = OpenSeadragon on a DZI of 512 px WebP tiles.
import { makeProjection } from './proj.js';
import { LANDMARKS } from './landmarks.js';
import { initPlanes } from './planes.js';
import { follow, setPainted, isPainted } from './vehicles.js';
import { GEO } from './geo.js';
import { initBuses } from './buses.js';
import { initLife } from './life.js';
import { initCableCar } from './cablecar.js';
import { initTiltShift } from './tiltshift.js';
import { track, trackLooking, trackPerf } from './analytics.js';

const Q = new URLSearchParams(location.search);
// tiles: R2 (tiles.tirana.fyi, versioned prefix so they can be cached for long) in production, the local folder in development
const TILE_HOST = /(^|\.)tirana\.fyi$/.test(location.hostname) ? 'https://tiles.tirana.fyi/v1' : '..';
const CONFIG = {
  // Baked in so the first tiles can be requested without fetching the .dzi first.
  map: { base: Q.get('tiles') || `${TILE_HOST}/tiles_shaped/map`, width: 73728, height: 94208, tileSize: 512, overlap: 0, formats: ['avif', 'webp'], index: true },   // Tirana-shaped: city + corridor + airport (post/shape.py)
  canvasOrigin: [-40960, -69632],                                 // canvas px of the image's top-left corner
  // separately painted areas on the same camera canvas, placed at their true position (camera px origin)
  islands: [],                                                    // the airport is part of the shaped map now
  camera: GEO.camera,                                             // viewer/app/geo.js (shared with the Python pipeline)
  home: { lat: 41.3262, lon: 19.8196, zoom: 0.32 },
  features: { rotate: Q.has('rotate') },
};
const PROJ = makeProjection(CONFIG.camera);

// ---------------- i18n ----------------
const STR = {
  sq: { search: 'Kërko', searchPh: 'Kërko një vend, rrugë…', goto: 'Shko te', share: 'Ndaj', about: 'Rreth hartës', rotate: 'Rrotullo',
        zoomIn: 'Zmadho', zoomOut: 'Zvogëlo', home: 'E gjithë harta', close: 'Mbyll', copied: 'Lidhja u kopjua',
        attr: 'Të dhënat e hartës ©2026 Google · © OpenStreetMap', noResults: 'Asnjë rezultat', landmarks: 'Pika kryesore', places: 'Vende', loading: 'Duke ngarkuar…', photo: 'Foto', onMap: 'Në këtë hartë', flyHere: 'Shko atje', prev: 'E mëparshmja', next: 'Tjetra', artCredit: 'Art: GPT Image 2.6, krijuar për këtë hartë', illustration: 'Ilustrim', views: 'Pamjet', diorama: 'Diorama', poster: 'Poster', landmarksBtn: 'Pikat kryesore', following: 'Duke ndjekur', stopFollow: 'Ndalo', follow: 'Ndiq', unfollow: 'Mos ndiq', aCar: 'një makinë', landmarksOn: 'Pikat kryesore u shfaqën', landmarksOff: 'Pikat kryesore u fshehën', aboutBrand: 'Tiny Tirana: rreth hartës', howLink: 'Si u bë kjo hartë (anglisht) →', planes: 'Avionët live', onGround: 'në tokë', demo: 'demo, jo e vërtetë', planesLive: '✈ {n} avionë live', planesNone: '✈ Asnjë avion tani', planesDemo: '✈ {n} avionë demo', buses: 'Autobusët (sipas orarit)', life: 'Makina',
        kinds: { landmark: 'monument', square: 'shesh', park: 'park', water: 'ujë', neighbourhood: 'lagje', place: 'vend', street: 'rrugë', building: 'ndërtesë' },
        aboutBody: `<p>Një pikturë izometrike pixel-art e qytetit të Tiranës dhe aeroportit të Rinasit, e vizatuar bllok pas blloku nga një model i trajnuar mbi pamjet 3D të qytetit.</p>
          <p>Projekt personal, jo-tregtar. Pikturuar me Qwen-Image 2.1 + LoRA <i>tiranaiso</i>. Gjeometria nga Google Photorealistic 3D Tiles; emrat nga OpenStreetMap.</p>
          <p>Bërë nga <a href="https://github.com/okanerturan" rel="noopener">@okanerturan</a> me Claude (Anthropic): Claude shkroi kodin dhe drejtoi gjithë procesin, nga trajnimi te piktura. <a href="https://github.com/okanerturan/tiny-tirana" rel="noopener">Kodi burimor në GitHub</a>.</p>
          <p>Frymëzuar nga <a href="https://tiny.london" rel="noopener">tiny.london</a>, <a href="https://isometric.nyc" rel="noopener">isometric.nyc</a> dhe <a href="https://tiny.london/world/" rel="noopener">hartat e tjera</a>. Të gjitha i kemi mbledhur në <a href="../world/">atlasin tonë të qyteteve izometrike</a>.</p>
          <p class="privacy">Statistika anonime: pa cookies dhe pa të dhëna personale. Numërojmë cilat vende dhe funksione përdoren, sa kohë shihet harta, sa shpejt ngarkohet dhe gabimet e faqes; nga serveri ruhet vetëm shteti, jo adresa IP. Nëse shfletuesi juaj kërkon të mos ndiqet (Do Not Track / GPC), nuk dërgohet asgjë.</p>` },
  en: { search: 'Search', searchPh: 'Search a place, street…', goto: 'Go to', share: 'Share', about: 'About this map', rotate: 'Rotate',
        zoomIn: 'Zoom in', zoomOut: 'Zoom out', home: 'Whole map', close: 'Close', copied: 'Link copied',
        attr: 'Map data ©2026 Google · © OpenStreetMap', noResults: 'No results', landmarksBtn: 'Landmarks', following: 'Following', stopFollow: 'Stop', follow: 'Follow', unfollow: 'Unfollow', aCar: 'a car', landmarksOn: 'Landmarks shown', landmarksOff: 'Landmarks hidden', landmarks: 'Landmarks', places: 'Places', loading: 'Loading…', photo: 'Photo', onMap: 'On this map', flyHere: 'Fly here', prev: 'Previous', next: 'Next', artCredit: 'Art: GPT Image 2.6, made for this map', illustration: 'Illustration', views: 'Views', diorama: 'Diorama', poster: 'Poster', aboutBrand: 'Tiny Tirana: about this map', howLink: 'How this map was made →', planes: 'Live planes', onGround: 'on the ground', demo: 'demo, not real', planesLive: '✈ {n} live planes', planesNone: '✈ No planes right now', planesDemo: '✈ {n} demo planes', buses: 'Buses (timetable)', life: 'Cars',
        kinds: { landmark: 'landmark', square: 'square', park: 'park', water: 'water', neighbourhood: 'area', place: 'place', street: 'street', building: 'building' },
        aboutBody: `<p>An isometric pixel-art painting of the city of Tirana and Rinas airport, drawn block by block by a model trained on the city's 3D view.</p>
          <p>Personal, non-commercial project. Painted with Qwen-Image 2.1 + the <i>tiranaiso</i> LoRA. Geometry from Google Photorealistic 3D Tiles; names from OpenStreetMap.</p>
          <p>Made by <a href="https://github.com/okanerturan" rel="noopener">@okanerturan</a> with Claude (Anthropic): Claude wrote the code and ran the whole pipeline, from training to the painting. <a href="https://github.com/okanerturan/tiny-tirana" rel="noopener">Source on GitHub</a>.</p>
          <p>Inspired by <a href="https://tiny.london" rel="noopener">tiny.london</a>, <a href="https://isometric.nyc" rel="noopener">isometric.nyc</a> and <a href="https://tiny.london/world/" rel="noopener">the other maps</a>. We collected them all in <a href="../world/">our atlas of isometric cities</a>.</p>
          <p class="privacy">Anonymous statistics: no cookies and no personal data. We count which places and features get used, how long the map is looked at, how fast it loads and page errors; the server keeps only the country, never the IP address. If your browser asks not to be tracked (Do Not Track / GPC), nothing is sent.</p>` },
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let lang = Q.get('lang') || store.get('lang') || ((navigator.language || '').startsWith('sq') ? 'sq' : 'en');
const t = k => STR[lang][k];
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  const lb = document.getElementById('langBtn'); lb.textContent = lang === 'sq' ? 'EN' : 'SQ'; lb.setAttribute('aria-label', lang === 'sq' ? 'English' : 'Shqip');
  buildGoto(); labelMarkers(); if (cardIdx >= 0) openCard(LANDMARKS[cardIdx], cardReturn); planesCtl?.refreshLabels();
}

// ---------------- map ----------------
const M = CONFIG.map, maxLevel = Math.ceil(Math.log2(Math.max(M.width, M.height)));
// AVIF is ~30 % smaller at the same quality; one 1x1 decode test decides, WebP otherwise.
const AVIF = await new Promise(res => { const i = new Image(); i.onload = () => res(i.width === 1); i.onerror = () => res(false);
  i.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAKAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAMG1kYXQSAAoIGAAGiAhoNCAyGhlHh4Yhh5555oAAAJBAyRxgkGEETy8OpPuA'; });
const ext = layer => (AVIF && layer.formats.includes('avif') ? 'avif' : 'webp');
// Which tiles exist ({base}_index.json from post/tile_index.py): empty tiles are never written, so never ask for them.
const tileIndex = async layer => {
  if (!layer.index) return;
  try {
    const d = await (await fetch(`${layer.base}_index.json`)).json();
    layer.has = Object.fromEntries(Object.entries(d.levels).map(([l, [cols, , b64]]) => [l, { cols, bits: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }]));
  } catch (e) { console.warn('[tiles] no index for', layer.base, e); }
};
const dzi = layer => { const e = ext(layer), w = layer.width ?? M.width, h = layer.height ?? M.height;
  const src = { width: w, height: h, tileSize: layer.tileSize ?? M.tileSize, tileOverlap: layer.overlap ?? M.overlap, minLevel: 8,
    maxLevel: Math.ceil(Math.log2(Math.max(w, h))), getTileUrl: (l, x, y) => `${layer.base}_files/${l}/${x}_${y}.${e}` };
  if (layer.has) src.tileExists = (l, x, y) => { const t = layer.has[l]; if (!t) return true; const i = y * t.cols + x; return x < t.cols && !!(t.bits[i >> 3] & (1 << (i & 7))); };
  return src; };
await Promise.all([M, ...CONFIG.islands].map(tileIndex));
if (M.has?.[maxLevel]) setPainted({ origin: CONFIG.canvasOrigin, cell: M.tileSize, ...M.has[maxLevel] });   // vehicles only where it's painted
await new Promise(r => (window.OpenSeadragon ? r() : addEventListener('load', r, { once: true })));
const MAX_ZOOM = 0.8;   // image px per screen px
const viewer = OpenSeadragon({
  element: document.getElementById('map'), tileSources: dzi(M),
  showNavigationControl: false, maxZoomPixelRatio: MAX_ZOOM,   // closer than this the painting starts to read as a photo
  showNavigator: true, navigatorId: 'minimap', navigatorAutoResize: true, navigatorAutoFade: false, navigatorDisplayRegionColor: 'transparent', minZoomImageRatio: 0.85, visibilityRatio: 0.6, constrainDuringPan: true,
  imageLoaderLimit: 8, maxImageCacheCount: 500, immediateRender: false, blendTime: 0.15, animationTime: 0.9, springStiffness: 7.5,
  preserveImageSizeOnResize: true, gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true }, gestureSettingsTouch: { pinchRotate: false },
  crossOriginPolicy: false,
});
const item = () => viewer.world.getItemAt(0);
const ox = CONFIG.canvasOrigin[0], oy = CONFIG.canvasOrigin[1];
// The 3D model's ground in central Tirana is ~146 m (ellipsoidal), 9 m below the camera anchor height; place things on it.
const GROUND = GEO.ground;
const toImage = (lat, lon, h = GROUND) => { const [u, v] = PROJ.toPx(lat, lon, h); return [u - ox, v - oy]; };
// A landmark whose ground point is not on the painting (under the clouds of the shaped map) gets no marker, card or list entry.
for (let i = LANDMARKS.length - 1; i >= 0; i--) { const p = LANDMARKS[i], [u, v] = PROJ.toPx(p.lat, p.lon, p.ground ?? GROUND); if (!isPainted(u, v)) LANDMARKS.splice(i, 1); }
const toLatLon = (x, y) => PROJ.toLatLon(x + ox, y + oy, GROUND - CONFIG.camera.groundH);
// Nearest-neighbour above 100 %, smooth below: pixel art stays crisp when you dive in.
const smoothing = () => { const it = item(); if (it) viewer.drawer.setImageSmoothingEnabled(it.viewportToImageZoom(viewer.viewport.getZoom(true)) < 1); };
viewer.addHandler('animation', smoothing);

// Pan/zoom so (lat, lon) sits at the centre of the part of the map not covered by the card (side panel or bottom sheet).
function go(lat, lon, zoom, immediately = false) {
  const it = item(); if (!it) return;
  const [x, y] = toImage(lat, lon), vz = it.imageToViewportZoom(Math.min(zoom, MAX_ZOOM));
  let target = it.imageToViewportCoordinates(x, y);
  const c = document.getElementById('card');
  if (c && !c.hidden) {
    const r = c.getBoundingClientRect(), W = innerWidth, H = innerHeight, barBottom = document.querySelector('.bar').getBoundingClientRect().bottom;
    // centre of the uncovered area: above the card if it spans most of the width, otherwise left of it
    const above = r.width > W * 0.6;
    const dx = above ? 0 : W / 2 - r.left / 2, dy = above ? H / 2 - (barBottom + r.top) / 2 : 0;
    const perPx = 1 / (viewer.viewport.getContainerSize().x * vz / 1);  // viewport units per screen px at the target zoom
    target = target.plus(new OpenSeadragon.Point(dx * perPx, dy * perPx));
  }
  viewer.viewport.panTo(target, immediately);
  viewer.viewport.zoomTo(vz, null, immediately);
}

// ---------------- URL state: #lat,lon,zoom ----------------
function readHash() {
  const m = location.hash.slice(1).split(',').map(Number);
  return m.length >= 3 && m.every(Number.isFinite) ? { lat: m[0], lon: m[1], zoom: m[2] } : null;
}
function writeHash() {
  const it = item(); if (!it) return;
  const c = it.viewportToImageCoordinates(viewer.viewport.getCenter(true)), [lat, lon] = toLatLon(c.x, c.y);
  const z = it.viewportToImageZoom(viewer.viewport.getZoom(true));
  history.replaceState(null, '', `#${lat.toFixed(5)},${lon.toFixed(5)},${z.toFixed(3)}`);
}
viewer.addHandler('animation-finish', writeHash);
viewer.addHandler('open', () => {
  const s = readHash() || CONFIG.home; go(s.lat, s.lon, s.zoom, true); smoothing(); addMarkers();
  // painted islands (the airport) at their true place on the same canvas; kept off the minimap so it stays on the city
  for (const isl of CONFIG.islands) viewer.addTiledImage({ tileSource: dzi(isl), x: (isl.origin[0] - ox) / M.width, y: (isl.origin[1] - oy) / M.width,
    width: isl.width / M.width, success: e => { e.item.__island = isl.name; } });
  viewer.navigator?.world.addHandler('add-item', e => { if (viewer.navigator.world.getItemCount() > 1 && e.item !== viewer.navigator.world.getItemAt(0)) viewer.navigator.world.removeItem(e.item); });
  planesCtl = initPlanes({ viewer, item, t, lang, button: document.getElementById('planesBtn'), chip: document.getElementById('planesChip'),
    imgAt: (lat, lon, h) => { const [u, v] = PROJ.toPx(lat, lon, h); return [u - ox, v - oy]; } });
  initLife({ viewer, item, origin: CONFIG.canvasOrigin, button: document.getElementById('lifeBtn'), avif: AVIF }).catch(e => console.warn('[life]', e));
  initCableCar({ viewer, item, origin: CONFIG.canvasOrigin }).catch(e => console.warn('[cablecar]', e));
  initBuses({ viewer, item, button: document.getElementById('busesBtn'), chip: document.getElementById('busesChip'), origin: CONFIG.canvasOrigin, lang: () => lang });
  try { initTiltShift({ viewer, item, button: document.getElementById('tsBtn') }); } catch (e) { console.warn('[tiltshift]', e); }
});
let planesCtl = null;
follow.init({ viewer, chip: document.getElementById('followChip'), t: k => t(k) });
addEventListener('hashchange', () => { const s = readHash(); if (s) go(s.lat, s.lon, s.zoom); });

// ---------------- pin ----------------
let pin = null;
function clearPin() { if (pin) { viewer.removeOverlay(pin); pin = null; } }
function dropPin(lat, lon, label) {
  const it = item(); if (!it) return;
  if (pin) viewer.removeOverlay(pin);
  pin = document.createElement('div'); pin.className = 'pin';
  const s = document.createElement('span'); s.textContent = label; pin.append(s);
  const [x, y] = toImage(lat, lon);
  viewer.addOverlay({ element: pin, location: it.imageToViewportCoordinates(x, y), checkResize: false });
}

// ---------------- search (index loaded on first focus) ----------------
const KIND_RANK = { landmark: 0, square: 1, park: 2, water: 2, neighbourhood: 3, place: 3, street: 4, building: 5 };
const KIND_ZOOM = { landmark: 0.9, square: 0.7, park: 0.35, water: 0.25, neighbourhood: 0.3, place: 0.3, street: 0.55, building: 0.9 };
const ALIAS = { skanderbeg: 'skenderbej', scanderbeg: 'skenderbej', pyramid: 'piramida', castle: 'kalaja', lake: 'liqeni', square: 'sheshi', mosque: 'xhamia',
  church: 'kisha', bridge: 'ura', street: 'rruga', boulevard: 'bulevardi', stadium: 'stadiumi', park: 'parku', mother: 'nene', teresa: 'tereza', clock: 'sahatit', tower: 'kulla' };
const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let index = null, indexing = null;
const loadIndex = () => indexing ??= fetch('search.json').then(r => r.json()).then(d => {
  index = d.items.map(([name, alt, kind, lat, lon]) => ({ name, alt, kind, lat, lon, key: norm(`${name} ${alt}`) }));
});
function search(q) {
  const toks = norm(q).split(' ').filter(Boolean); if (!toks.length || !index) return [];
  const alts = toks.map(w => [w, ALIAS[w]].filter(Boolean));
  const out = [];
  for (const it of index) {
    let score = 0;
    for (const forms of alts) {
      let best = 9;
      for (const w of forms) {
        if (it.key.startsWith(w)) best = Math.min(best, 0);
        else if (it.key.includes(' ' + w)) best = Math.min(best, 1);
        else if (it.key.includes(w)) best = Math.min(best, 2);
      }
      if (best === 9) { score = -1; break; }
      score += best;
    }
    if (score >= 0) out.push({ it, s: score * 10 + KIND_RANK[it.kind] + it.key.length / 100 });
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 8).map(o => o.it);
}
const qEl = document.getElementById('q'), resEl = document.getElementById('results');
let hits = [], sel = -1;
function renderResults() {
  resEl.replaceChildren();
  if (!qEl.value.trim()) { resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); return; }
  if (!index) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('loading'); resEl.append(li); }
  else if (!hits.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('noResults'); resEl.append(li); }
  hits.forEach((h, i) => {
    const li = document.createElement('li'); li.id = `r${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === sel));
    const name = document.createElement('span'); name.textContent = h.name;
    const kind = document.createElement('small'); kind.textContent = t('kinds')[h.kind];
    li.append(name, kind); li.addEventListener('pointerdown', e => { e.preventDefault(); choose(i); });
    resEl.append(li);
  });
  resEl.hidden = false; qEl.setAttribute('aria-expanded', 'true');
  qEl.setAttribute('aria-activedescendant', sel >= 0 ? `r${sel}` : '');
}
function choose(i) {
  const h = hits[i]; if (!h) return;
  go(h.lat, h.lon, KIND_ZOOM[h.kind]); dropPin(h.lat, h.lon, h.name); track('search', { found: true, kind: h.kind });
  qEl.value = h.name; hits = []; sel = -1; renderResults(); qEl.blur();
}
qEl.addEventListener('focus', () => loadIndex().then(() => { hits = search(qEl.value); renderResults(); }), { once: false });
qEl.addEventListener('input', () => { hits = search(qEl.value); sel = hits.length ? 0 : -1; renderResults(); });
qEl.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); renderResults(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderResults(); e.preventDefault(); }
  else if (e.key === 'Enter') { if (!hits.length && qEl.value.trim()) track('search', { found: false }); choose(Math.max(0, sel)); e.preventDefault(); }
  else if (e.key === 'Escape') { qEl.value = ''; hits = []; renderResults(); qEl.blur(); }
});
qEl.addEventListener('blur', () => setTimeout(() => { resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }, 120));
addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== qEl) { e.preventDefault(); qEl.focus(); } });

// ---------------- go-to menu ----------------
// Landmarks with cards (landmarks.js) + a few places that only fly (no card).
const EXTRA = [
  { name: { sq: 'Blloku', en: 'Blloku' }, lat: 41.32133, lon: 19.81607, zoom: 0.45 },
  { name: { sq: 'Sheshi Nënë Tereza', en: 'Mother Teresa Square' }, lat: 41.31788, lon: 19.82129, zoom: 0.6 },
  { name: { sq: 'Liqeni i Tiranës', en: 'Tirana Lake' }, lat: 41.308758, lon: 19.820028, zoom: 0.22 },
  { name: { sq: 'Parku i Madh', en: 'Grand Park' }, lat: 41.3105, lon: 19.8235, zoom: 0.25 },
];
const nm = p => p.name[lang];
const pic = (base, alt, cls = '', sizes = '') => `<picture><source type="image/avif" srcset="lm/${base}.avif"><img ${cls ? `class="${cls}"` : ''} src="lm/${base}.webp" alt="${alt}" decoding="async" ${sizes}></picture>`;
const iconPic = (id, alt = '') => `<picture><source type="image/avif" srcset="lm/${id}-icon96.avif 1x, lm/${id}-icon192.avif 2x"><img src="lm/${id}-icon96.webp" srcset="lm/${id}-icon192.webp 2x" alt="${alt}" width="96" height="96" decoding="async"></picture>`;

// ---------------- landmark markers ----------------
// Each marker floats just above the TOP of its own landmark (heights from the 3D model, landmarks.js `top`) with a stem
// down to it, so it never covers the building it names. Icons show at every zoom; names show when zoomed in (or on
// hover/focus). Markers are decluttered by their on-screen boxes; the open card's landmark always wins.
const markers = [];
let lmOn = true;
try { lmOn = localStorage.getItem('tt-landmarks') !== 'off'; } catch {}
function addMarkers() {
  const it = item();
  for (const p of LANDMARKS) {
    const el = document.createElement('button'); el.className = 'lm'; el.type = 'button';
    el.innerHTML = `<span class="lm-chip"><span class="lm-ic">${iconPic(p.id)}</span><span class="lm-name"></span></span><i class="lm-stem" aria-hidden="true"></i>`;
    // OSD captures pointer events on its canvas, so a plain 'click' never fires on overlays: use its MouseTracker.
    new OpenSeadragon.MouseTracker({ element: el, clickHandler: e => { e.preventDefaultAction = true; openCard(p, el); } });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(p, el); } });
    const [x, y] = toImage(p.lat, p.lon, (p.top ?? GROUND) + 3), pt = it.imageToViewportCoordinates(x, y);
    viewer.addOverlay({ element: el, location: pt, placement: OpenSeadragon.Placement.BOTTOM, checkResize: false });
    markers.push({ el, p, pt, w: 0, h: 0 });
  }
  labelMarkers(); applyLandmarksOn(); layoutMarkers(); addMinimapDots();
}
function labelMarkers() { for (const m of markers) { m.el.querySelector('.lm-name').textContent = nm(m.p); m.el.setAttribute('aria-label', nm(m.p)); m.w = 0; } }
const NEAR = 0.2;   // image zoom from which names are always shown
function layoutMarkers() {
  const it = item(); if (!it || !markers.length) return;
  const z = it.viewportToImageZoom(viewer.viewport.getZoom(true)), near = z >= NEAR;
  const mapEl = document.getElementById('map');
  if (mapEl.classList.contains('lm-near') !== near) { mapEl.classList.toggle('lm-near', near); for (const m of markers) m.w = 0; }
  const boxes = [], order = [...markers].sort((a, b) => (b.el.classList.contains('active') - a.el.classList.contains('active')));
  for (const m of order) {                                                     // LANDMARKS order = priority
    if (!m.w) { const r = m.el.getBoundingClientRect(); m.w = r.width || 56; m.h = r.height || 64; }
    const s = viewer.viewport.pixelFromPoint(m.pt, true);
    const box = [s.x - m.w / 2 - 4, s.y - m.h - 4, s.x + m.w / 2 + 4, s.y];
    const ok = boxes.every(b => box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]);
    if (ok) boxes.push(box);
    m.el.classList.toggle('off', !ok); m.el.tabIndex = ok && lmOn ? 0 : -1;
  }
}
viewer.addHandler('animation', layoutMarkers);
viewer.addHandler('resize', layoutMarkers);

// landmarks toggle (map markers + minimap dots); remembered per browser
function applyLandmarksOn() {
  document.body.classList.toggle('hide-lm', !lmOn);
  const b = document.getElementById('lmBtn'); if (b) b.setAttribute('aria-pressed', String(lmOn));
  for (const m of markers) m.el.tabIndex = lmOn && !m.el.classList.contains('off') ? 0 : -1;
}
document.getElementById('lmBtn')?.addEventListener('click', () => {
  lmOn = !lmOn; try { localStorage.setItem('tt-landmarks', lmOn ? 'on' : 'off'); } catch {}
  applyLandmarksOn(); toast(t(lmOn ? 'landmarksOn' : 'landmarksOff'));
});

// minimap: a small dot per landmark
function addMinimapDots() {
  const nav = viewer.navigator; if (!nav) return;
  const place = () => {
    const nit = nav.world.getItemAt(0); if (!nit || nav.__dots) return;
    nav.__dots = true;
    for (const p of LANDMARKS) {
      const d = document.createElement('i'); d.className = 'mm-dot'; d.title = nm(p);
      const [x, y] = toImage(p.lat, p.lon, p.top ?? GROUND);
      nav.addOverlay({ element: d, location: nit.imageToViewportCoordinates(x, y), placement: OpenSeadragon.Placement.CENTER, checkResize: false });
    }
  };
  if (nav.world.getItemCount()) place(); else nav.world.addHandler('add-item', place);
}

// ---------------- landmark card ----------------
const card = document.getElementById('card');
let credits = null, cardIdx = -1, cardReturn = null;
const loadCredits = () => credits ? Promise.resolve(credits) : fetch('lm/credits.json').then(r => r.json()).then(c => (credits = c));
// The card never scrolls: if its content is taller than the space, the image gives up exactly the overflow (to a floor).
function fitCard() {
  const card = document.getElementById('card'), st = card?.querySelector('.stage'); if (!st || card.hidden) return;
  st.style.maxBlockSize = '';
  requestAnimationFrame(() => {
    const over = Math.max(card.scrollHeight - card.clientHeight, (card.querySelector('.card-body')?.scrollHeight ?? 0) - (card.querySelector('.card-body')?.clientHeight ?? 0));
    if (over > 0) st.style.maxBlockSize = `${Math.max(128, st.getBoundingClientRect().height - over - 2)}px`;
  });
}
addEventListener('resize', () => fitCard());
let cardSeen = null;   // { id, t }: how long a card stayed open (analytics 'card')
const cardDone = () => { if (cardSeen) track('card', { id: cardSeen.id, secs: Math.round((performance.now() - cardSeen.t) / 1000) }); cardSeen = null; };
async function openCard(p, from) {
  cardDone(); cardSeen = { id: p.id, t: performance.now() };
  cardIdx = LANDMARKS.indexOf(p); cardReturn = from || document.activeElement; track('landmark', { id: p.id });
  const c = (await loadCredits())[p.id] || {};
  const facts = p.facts[lang].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const icon = { diorama: '<path d="M12 3 21 8l-9 5-9-5 9-5Z"/><path d="M3 8v5l9 5 9-5V8"/>', poster: '<path d="M4 16l4.5-5 3.5 4 2.5-3L20 16M4 5h16v14H4z"/>', photo: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
                 map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>' };
  const VIEWS = p.views || ['diorama', 'poster', 'photo', 'map'];       // landmarks without generated art: painted map + photo
  const tab = (v, label) => `<button type="button" data-v="${v}" aria-pressed="${v === VIEWS[0]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${icon[v]}</svg><span class="lbl">${label}</span></button>`;
  const view = (base, v, alt) => `<picture><source type="image/avif" srcset="lm/${base}.avif"><img class="view" data-v="${v}" src="lm/${base}.webp" alt="${alt}" decoding="async"></picture>`;
  card.innerHTML = `
    <div class="stage" data-show="${VIEWS[0]}">
      ${VIEWS.map(v => view(`${p.id}-${v}`, v, (v === 'map' ? t('onMap') : t(v)) + ': ' + nm(p))).join('')}
      <p class="credit diorama poster">${t('artCredit')}</p>
      <p class="credit photo">${t('photo')}: <a href="${c.page}" target="_blank" rel="noopener">${c.artist || 'Wikimedia Commons'}</a> · <a href="${c.license_url || c.page}" target="_blank" rel="noopener">${c.license || ''}</a></p>
      <p class="credit map">${t('onMap')}</p>
      <div class="stamp">${iconPic(p.id)}</div>
      <div class="tabs-v" role="group" aria-label="${t('views')}">${VIEWS.map(v => tab(v, v === 'map' ? t('onMap') : t(v))).join('')}</div>
    </div>
    <div class="card-body">
      <button class="card-close btn" type="button" aria-label="${t('close')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <p class="kind">${p.kind[lang]}</p>
      <h2 id="cardTitle">${nm(p)}</h2>
      <p class="desc">${p.text[lang]}</p>
      <dl class="facts">${facts}</dl>
      <div class="card-actions">
        <button class="btn" type="button" data-act="prev" aria-label="${t('prev')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
        <button class="btn primary" type="button" data-act="fly">${t('flyHere')}</button>
        <button class="btn" type="button" data-act="next" aria-label="${t('next')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
      </div>
    </div>`;
  const stage = card.querySelector('.stage');
  for (const b of card.querySelectorAll('.tabs-v button')) b.addEventListener('click', () => {
    stage.dataset.show = b.dataset.v; for (const o of card.querySelectorAll('.tabs-v button')) o.setAttribute('aria-pressed', String(o === b)); track('tab', { v: b.dataset.v }); });
  card.hidden = false; card.scrollTop = 0; fitCard();
  go(p.lat, p.lon, Math.min(p.zoom, 0.5)); clearPin();   // the landmark's own marker marks the spot (no second label)
  for (const m of markers) m.el.classList.toggle('active', m.p === p);
  card.querySelector('.card-close').addEventListener('click', closeCard);
  card.querySelector('[data-act="fly"]').addEventListener('click', () => { go(p.lat, p.lon, p.zoom); });
  card.querySelector('[data-act="prev"]').addEventListener('click', () => openCard(LANDMARKS[(cardIdx + LANDMARKS.length - 1) % LANDMARKS.length]));
  card.querySelector('[data-act="next"]').addEventListener('click', () => openCard(LANDMARKS[(cardIdx + 1) % LANDMARKS.length]));
  card.querySelector('h2').focus?.(); card.querySelector('.card-close').focus({ preventScroll: true });
}
function closeCard() { cardDone(); card.hidden = true; cardIdx = -1; for (const m of markers) m.el.classList.remove('active'); cardReturn?.focus?.({ preventScroll: true, focusVisible: false }); }
addEventListener('keydown', e => {
  if (cardIdx < 0) return;
  if (e.key === 'Escape') closeCard();
  else if (e.key === 'ArrowRight' && card.contains(document.activeElement)) openCard(LANDMARKS[(cardIdx + 1) % LANDMARKS.length]);
  else if (e.key === 'ArrowLeft' && card.contains(document.activeElement)) openCard(LANDMARKS[(cardIdx + LANDMARKS.length - 1) % LANDMARKS.length]);
});

function buildGoto() {
  const el = document.getElementById('goto'); el.replaceChildren();
  const h = document.createElement('h2'); h.textContent = t('landmarks'); el.append(h);
  for (const p of LANDMARKS) {
    const b = document.createElement('button'); b.innerHTML = iconPic(p.id); b.append(nm(p));
    b.addEventListener('click', () => { el.hidePopover(); openCard(p, document.getElementById('gotoBtn')); });
    el.append(b);
  }
  const h2 = document.createElement('h2'); h2.textContent = t('places'); el.append(h2);
  for (const p of EXTRA) {
    const b = document.createElement('button'); b.className = 'plain'; b.textContent = nm(p);
    b.addEventListener('click', () => { el.hidePopover(); go(p.lat, p.lon, p.zoom); dropPin(p.lat, p.lon, nm(p)); });
    el.append(b);
  }
}

// ---------------- share, toast ----------------
const toast = msg => { const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 1800); };
document.getElementById('shareBtn').addEventListener('click', async () => {
  writeHash(); const url = location.href; track('share');
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'Tiny Tirana', url }); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { prompt('', url); }
});

// ---------------- zoom / home ----------------
document.getElementById('inBtn').addEventListener('click', () => viewer.viewport.zoomBy(1.6));
document.getElementById('outBtn').addEventListener('click', () => viewer.viewport.zoomBy(1 / 1.6));
document.getElementById('homeBtn').addEventListener('click', () => viewer.viewport.goHome());

// ---------------- about ----------------
const about = document.getElementById('about');
document.getElementById('aboutBtn').addEventListener('click', () => about.showModal());
document.getElementById('aboutClose').addEventListener('click', () => about.close());
about.addEventListener('click', e => { if (e.target === about) about.close(); });

// ---------------- language ----------------
document.getElementById('langBtn').addEventListener('click', () => { lang = lang === 'sq' ? 'en' : 'sq'; store.set('lang', lang); applyLang(); });

// ---------------- rotation (gated: off until the 4 painted directions exist) ----------------
if (CONFIG.features.rotate) document.getElementById('cwBtn').hidden = false;

applyLang();
window.__tt = { viewer, go, avif: AVIF, origin: CONFIG.canvasOrigin, search: q => (loadIndex().then(() => search(q))), toLatLon, toImage };

// ---------------- anonymous usage statistics (analytics.js: cookieless; off with Do Not Track / GPC) ----------------
document.querySelector('.side')?.addEventListener('click', e => {
  const b = e.target.closest('.btn[aria-pressed]'); if (b) setTimeout(() => track('toggle', { id: b.id.replace(/Btn$/, ''), on: b.getAttribute('aria-pressed') === 'true' }), 0);
});
trackPerf(viewer);
trackLooking(() => { const it = item(); if (!it) return null; const c = it.viewportToImageCoordinates(viewer.viewport.getCenter(true)), [lat, lon] = toLatLon(c.x, c.y);
  return { lat, lon, z: it.viewportToImageZoom(viewer.viewport.getZoom(true)) }; });

// ---------------- clouds around the island (a sea of cloud that pans and zooms with the map) ----------------
{
  // One cloud tile covers CLOUD_IMG_PX image px, but never less than CLOUD_MIN screen px: zoomed far out the puffs keep
  // a readable size (the island shrinks under them) instead of turning into fine grain.
  const mapEl = document.getElementById('map'), CLOUD_IMG_PX = 2600, CLOUD_MIN = 128;   // small clouds (the first texture, preferred)
  const sync = () => { const it = item(); if (!it) return;
    const z = it.viewportToImageZoom(viewer.viewport.getZoom(true)), o = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), size = Math.max(CLOUD_MIN, CLOUD_IMG_PX * z);
    mapEl.style.backgroundSize = `${size.toFixed(2)}px`; mapEl.style.backgroundPosition = `${(o.x % size).toFixed(2)}px ${(o.y % size).toFixed(2)}px`; };
  viewer.addHandler('update-viewport', sync); viewer.addHandler('open', sync);
}
