// Tirana's city buses on Tiny Tirana, driven by the municipality's GTFS timetable (no live tracking: every bus is where
// the schedule says it is, Europe/Tirane time). Data: transit/buses.json (post/buses_bake.py), sprite: transit/bus.*
// (render/sprites/make_buses.mjs). Both are loaded only when the layer is first switched on.
//
// Drawing: ONE canvas over the map, redrawn in OSD's own animation tick while the view moves and in a rAF loop while the
// layer is on and the tab is visible. Shapes are baked in camera px, so the tile set's canvasOrigin is subtracted here.
// Where the street runs behind a roof or under trees (baked from the renderer's height pass, post/occlusion.py) the bus
// fades out and an x-ray silhouette is drawn over the occluder instead (stronger for the followed bus); hidden buses
// cannot be tapped, except the one being followed. Every frame the buses on the road are published in vehicles.js
// busesNow (camera px) so the cars can yield to them; sizes come from the shared vehiclePx scale.
// ?buses=on starts with the layer on, ?buses=demo also starts the demo clock, ?buses=08:30 fixes the demo start time.

import { vehiclePx, busesNow, carsNow, follow, isPainted, clipToPainting } from './vehicles.js';
import { track } from './analytics.js';
import { GEO } from './geo.js';

const DATA = 'transit/buses.json', SHEET = 'transit/bus', SPRITE_META = { N: 32, CELL: 112, VIEW: 14, length: 8.6 };
const MPP = GEO.camera.mpp, BUS_M = 12, BUS_LEN_PX = BUS_M / MPP;     // true 12 m bus; camera px
const HIDE_PAD_DM = 45, FADE_MS = 150, HIDDEN_LINE_ALPHA = 0.5;     // hidden stretches grow by about half a bus; fade time
const ACTIVE_EVERY_MS = 1500, REDUCED_STEP_MS = 3000, DEMO_START = 8 * 3600, TAP_SLOP = 6;
const S2 = Math.SQRT2;

const TXT = {
  sq: { label: 'Autobusët', loading: '🚌 Duke ngarkuar oraret…', running: '🚌 {n} autobusë në lëvizje', running1: '🚌 1 autobus në lëvizje',
        noneFirst: '🚌 Asnjë autobus tani · i pari në {t}', noneEnded: '🚌 Asnjë autobus tani · shërbimi mbaroi {t}', noneDay: '🚌 Asnjë autobus sot',
        demo: '🚌 Demo {t} · {n} autobusë · jo live', showDemo: 'Shfaq demon', live: 'Live', line: 'Linja', next: 'Ndalesa tjetër',
        now: 'tani', min: '{n} min', end: 'Fund i linjës', notLive: 'sipas orarit, jo GPS', demoNote: 'kohë demo, jo live', follow: 'Ndiq', unfollow: 'Mos ndiq',
        credit: 'Orari: Bashkia e Tiranës (GTFS), CC BY-SA 4.0', creditShort: 'GTFS © Bashkia e Tiranës, CC BY-SA', lines: 'Linjat', title: 'Linjat e autobusëve', filter: 'Kërko linjën ose ndalesën…',
        all: 'Të gjitha linjat', allMeta: '{n} autobusë në lëvizje', runningN: '{n} në lëvizje', every: 'çdo ~{n} min', nextAt: 'tjetri në {t}',
        firstAt: 'i pari në {t}', done: 'mbaroi për sot', noService: 'nuk punon sot', from: 'nga {s}', nextDeps: 'Nisjet e ardhshme',
        firstLast: 'I pari {a} · i fundit {b}', arriving: 'Mbërrin', noMore: 'asnjë tjetër sot', dayOf: 'Orari i {d}', noMatch: 'Asnjë linjë',
        close: 'Mbyll', stopsN: '{n} ndalesa', showAll: 'Të gjitha', failed: '🚌 Oraret nuk u ngarkuan' },
  en: { label: 'Buses', loading: '🚌 Loading timetable…', running: '🚌 {n} buses running', running1: '🚌 1 bus running',
        noneFirst: '🚌 No buses now · first at {t}', noneEnded: '🚌 No buses now · service ended {t}', noneDay: '🚌 No buses today',
        demo: '🚌 Demo {t} · {n} buses · not live', showDemo: 'Show demo', live: 'Live', line: 'Line', next: 'Next stop',
        now: 'now', min: '{n} min', end: 'End of the line', notLive: 'scheduled position, not GPS', demoNote: 'demo time, not live', follow: 'Follow', unfollow: 'Unfollow',
        credit: 'Timetable: Municipality of Tirana (GTFS), CC BY-SA 4.0', creditShort: 'GTFS © Tirana, CC BY-SA', lines: 'Lines', title: 'Bus lines', filter: 'Find a line or stop…',
        all: 'All lines', allMeta: '{n} buses running', runningN: '{n} running', every: 'every ~{n} min', nextAt: 'next at {t}',
        firstAt: 'first at {t}', done: 'done for today', noService: 'no service today', from: 'from {s}', nextDeps: 'Next departures',
        firstLast: 'First {a} · last {b}', arriving: 'Arriving', noMore: 'no more today', dayOf: 'Timetable for {d}', noMatch: 'No lines',
        close: 'Close', stopsN: '{n} stops', showAll: 'All', failed: '🚌 Timetable failed to load' },
};
const hhmm = s => { s = ((Math.round(s / 60) % 1440) + 1440) % 1440; return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const ymdAdd = (ymd, days) => { const d = new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100 + days));
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
const dowOf = ymd => (new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100)).getUTCDay() + 6) % 7;   // Mon = 0
const ease = k => k + 0.5 * (k * k * (3 - 2 * k) - k);       // gentle pull-away and braking at stops
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Local wall clock in Tirana, whatever the visitor's time zone.
function tiranaClock(tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return () => { const p = {}; for (const x of fmt.formatToParts(new Date())) p[x.type] = +x.value;
    return { ymd: p.year * 10000 + p.month * 100 + p.day, sec: p.hour * 3600 + p.minute * 60 + p.second + (Date.now() % 1000) / 1000 }; };
}

function decode(d) {
  const shapes = d.shapes.map((f, si) => {
    const n = f.length / 3, u = new Float64Array(n), v = new Float64Array(n), s = new Float64Array(n);
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) { a += f[3 * i]; b += f[3 * i + 1]; c += f[3 * i + 2]; u[i] = a; v[i] = b; s[i] = c; }
    const h = d.hidden?.[si] || [], hid = new Float64Array(h.length); let t = 0;          // [start, end, start, end, ...] dm
    for (let i = 0; i < h.length; i++) { t += h[i]; hid[i] = t; }
    return { u, v, s, n, hid };
  });
  const runs = d.runs.map(r => {
    const m = (r.length - 1) / 2, arr = new Float64Array(m), dep = new Float64Array(m); let t = 0;
    for (let i = 0; i < m; i++) { t += r[1 + 2 * i]; arr[i] = t; t += r[2 + 2 * i]; dep[i] = t; }
    return { pat: d.pats[r[0]], arr, dep, dur: arr[m - 1] };
  });
  const routes = d.routes.map(([short, long, color]) => {
    const n = parseInt(color.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return { short, long, color, ink: lum > 0.62 ? '#1d1a17' : '#ffffff' };
  });
  return { ...d, shapes, runs, routes };
}

export function initBuses({ viewer, item, button, chip, origin, lang: getLang }) {
  const P = new URLSearchParams(location.search), arg = P.get('buses'), debugLines = arg === 'debug';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tx = k => TXT[getLang() === 'sq' ? 'sq' : 'en'][k];
  let on = false, data = null, loading = null, img = null, now = null, demo = null, failed = false;
  let raf = 0, stepTimer = 0, activeAt = -1e9, lastDraw = 0, open = null, chipKey = '';
  let active = [];                                    // bus states currently on the road (whole network)
  let sel = -1, selGeo = null, running = null, debugPaths = null;        // selected line (route index, -1 = all), its drawn path + stops, buses per line
  const states = new Map();                           // key -> state, reused while a trip runs
  const drawList = [];                                // reused every frame

  // ---------- DOM: one canvas under the overlays, one tooltip ----------
  const cv = document.createElement('canvas'); cv.className = 'buses-layer'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  viewer.canvas.insertBefore(cv, viewer.drawer.canvas?.nextSibling || null);
  const tip = document.createElement('div'); tip.className = 'bus-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  viewer.element.append(tip);
  const chipText = chip.querySelector('.txt'), chipBtn = chip.querySelector('button');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); W = viewer.container.clientWidth; H = viewer.container.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }

  // ---------- sprite atlas: one tinted cell per (route colour, heading), built on demand ----------
  const { N, CELL } = SPRITE_META, SLOTS = 16, atlas = document.createElement('canvas'), scratch = document.createElement('canvas');
  atlas.width = atlas.height = SLOTS * CELL; scratch.width = scratch.height = CELL;
  const cellCv = document.createElement('canvas'); cellCv.width = cellCv.height = CELL;
  const actx = atlas.getContext('2d'), sctx = scratch.getContext('2d'), cctx = cellCv.getContext('2d');
  const slotOf = new Map(); let nextSlot = 0;
  function cell(route, f) {
    const key = route * N + f; let s = slotOf.get(key);
    if (s !== undefined) return s;
    if (nextSlot >= SLOTS * SLOTS) { slotOf.clear(); nextSlot = 0; }          // full: start over (rare, cheap)
    s = nextSlot++; slotOf.set(key, s);
    const x = (s % SLOTS) * CELL, y = Math.floor(s / SLOTS) * CELL;
    sctx.globalCompositeOperation = 'copy'; sctx.drawImage(img, f * CELL, CELL, CELL, CELL, 0, 0, CELL, CELL);
    sctx.globalCompositeOperation = 'source-in'; sctx.fillStyle = data.routes[route].color; sctx.fillRect(0, 0, CELL, CELL);
    // composite ops like 'copy' / 'destination-in' touch the whole canvas, so build the cell on its own canvas first
    cctx.globalCompositeOperation = 'copy'; cctx.drawImage(img, f * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
    cctx.globalCompositeOperation = 'multiply'; cctx.drawImage(scratch, 0, 0);
    cctx.globalCompositeOperation = 'destination-in'; cctx.drawImage(img, f * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
    actx.clearRect(x, y, CELL, CELL);
    actx.shadowColor = 'rgba(255,253,245,0.85)'; actx.shadowBlur = 3; actx.drawImage(cellCv, x, y); actx.shadowColor = 'transparent';   // soft sticker halo, like the landmark icons
    return s;
  }

  // ---------- x-ray: a hidden bus is drawn as a flat silhouette with a light outline over whatever hides it ----------
  // Two strips, built once from the sprite's body (alpha > 60 %, so the soft contact shadow is left out): the shape in
  // white, and a ~2 px ring around it (8 offset copies minus the shape). The followed bus gets its own colour + glow.
  let xFill = null, xRing = null;
  const xTmp = document.createElement('canvas'); xTmp.width = xTmp.height = CELL; const xctx = xTmp.getContext('2d');
  function buildXray() {
    const w = N * CELL, mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = CELL; return c; };
    xFill = mk(); xRing = mk();
    const f = xFill.getContext('2d', { willReadFrequently: true }); f.drawImage(img, 0, 0, w, CELL, 0, 0, w, CELL);
    const id = f.getImageData(0, 0, w, CELL), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] > 150 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }
    f.putImageData(id, 0, 0);
    const r = xRing.getContext('2d');
    for (let a = 0; a < 8; a++) r.drawImage(xFill, Math.round(Math.cos(a * Math.PI / 4) * 2.5), Math.round(Math.sin(a * Math.PI / 4) * 2.5));
    r.globalCompositeOperation = 'destination-out'; r.drawImage(xFill, 0, 0); r.globalCompositeOperation = 'source-over';
  }
  function xray(s, x0, y0, size, a) {
    if (!xFill) buildXray();
    const fx = s.f * CELL;
    if (s !== followed) {                                                     // plain: white ghost, light outline
      ctx.globalAlpha = 0.3 * a; ctx.drawImage(xFill, fx, 0, CELL, CELL, x0, y0, size, size);
      ctx.globalAlpha = 0.85 * a; ctx.drawImage(xRing, fx, 0, CELL, CELL, x0, y0, size, size);
      return;
    }
    const col = data.routes[s.route].color;                                   // followed: route colour, stronger, glowing
    for (const [src, alpha, glow] of [[xFill, 0.6, 0], [xRing, 1, 6]]) {
      xctx.globalCompositeOperation = 'copy'; xctx.drawImage(src, fx, 0, CELL, CELL, 0, 0, CELL, CELL);
      xctx.globalCompositeOperation = 'source-in'; xctx.fillStyle = col; xctx.fillRect(0, 0, CELL, CELL);
      ctx.globalAlpha = alpha * a; if (glow) { ctx.shadowColor = col; ctx.shadowBlur = glow; }
      ctx.drawImage(xTmp, x0, y0, size, size); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    }
  }

  // ---------- schedule ----------
  let clock = null;
  const T = { ymd: 0, sec: 0 }; let sync = null, syncAt = -1e9;
  function simNow() {                                  // { ymd, sec } in Tirana, live or demo (one reused object)
    const p = performance.now();
    if (demo) { T.ymd = demo.ymd; T.sec = demo.sec + (p - demo.t0) / 1000; return T; }
    if (p - syncAt > 1000) { sync = clock(); syncAt = p; }                    // Intl is not free: once a second
    T.ymd = sync.ymd; T.sec = sync.sec + (p - syncAt) / 1000; return T;
  }
  function servicesOn(ymd) {
    const dow = dowOf(ymd), out = [];
    data.services.forEach(([, mask, a, b, add, rem], i) => {
      if (add.includes(ymd) || (!rem.includes(ymd) && ymd >= a && ymd <= b && (mask >> dow) & 1)) out.push(i);
    });
    return out;
  }
  const dayCache = new Map();
  function day(ymd) {                                   // trips of one service day: { starts, runs, first, last }
    let d = dayCache.get(ymd);
    if (!d) {
      const list = [];
      for (const si of servicesOn(ymd)) { const tr = data.trips[si]; for (let i = 0; i < tr.length; i += 2) list.push([tr[i + 1], tr[i], si, i]); }
      list.sort((a, b) => a[0] - b[0]);
      let last = 0; for (const [s, r] of list) last = Math.max(last, s + data.runs[r].dur);
      d = { list, first: list.length ? list[0][0] : null, last: list.length ? last : null };
      dayCache.set(ymd, d); if (dayCache.size > 4) dayCache.delete(dayCache.keys().next().value);
    }
    return d;
  }
  function refreshActive(t) {
    const seen = new Set(); active.length = 0;
    for (const [ymd, off] of [[t.ymd, 0], [ymdAdd(t.ymd, -1), 86400]]) {       // yesterday's trips may run past midnight
      const T = t.sec + off;
      for (const [start, ri, si, i] of day(ymd).list) {
        if (start > T + 5) break;
        const run = data.runs[ri]; if (start + run.dur < T - 5) continue;
        const key = `${ymd}:${si}:${i}`; seen.add(key);
        let s = states.get(key);
        if (!s) {
          const [shape, route, headsign, stops, dists] = run.pat;
          s = { key, run, start, off, shape: data.shapes[shape], route, headsign, stops, dists, seg: 0, stop: 0, x: 0, y: 0, size: 0, f: 0, vis: false, next: -1, alpha: -1, hidden: false, hx: 1, hy: 0, placed: false, pub: { u: 0, v: 0, hx: 1, hy: 0, len: BUS_LEN_PX } };
          states.set(key, s);
        }
        s.off = off; active.push(s);
      }
    }
    for (const k of states.keys()) if (!seen.has(k)) states.delete(k);
    if (followed && !states.has(followed.key)) { follow.stop(); endFollow(); }
    if (open && !open.isStop && !states.has(open.key)) closeTip();
    running ??= new Uint16Array(data.routes.length); running.fill(0);
    for (const s of active) { const e = t.sec + s.off - s.start; if (e >= 0 && e <= s.run.dur) running[s.route]++; }
  }

  // distance along the shape (dm) -> camera px into out[0..1]; caches the segment in s.seg
  function along(s, dist, out, useCache) {
    const { u, v, s: d, n } = s.shape;
    let i = useCache ? s.seg : 0;
    if (dist <= d[0]) { out[0] = u[0]; out[1] = v[0]; return 0; }
    if (dist >= d[n - 1]) { out[0] = u[n - 1]; out[1] = v[n - 1]; return n - 2; }
    if (d[i] > dist) i = 0;
    if (!useCache || d[Math.min(n - 1, i + 8)] < dist) { let lo = i, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= dist) lo = m; else hi = m; } i = lo; }
    else while (i < n - 2 && d[i + 1] <= dist) i++;
    const k = (dist - d[i]) / ((d[i + 1] - d[i]) || 1);
    out[0] = u[i] + (u[i + 1] - u[i]) * k; out[1] = v[i] + (v[i + 1] - v[i]) * k;
    return i;
  }
  const A = [0, 0], B = [0, 0], C = [0, 0];
  const isHiddenRaw = (hid, dist) => { for (let i = 0; i < hid.length; i += 2) if (dist >= hid[i] && dist <= hid[i + 1]) return true; return false; };
  function isHidden(hid, dist) {                        // behind a building / under trees here? (binary search on the stretches)
    let lo = 0, hi = hid.length / 2 - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1;
      if (hid[2 * m + 1] + HIDE_PAD_DM < dist) lo = m + 1; else if (hid[2 * m] - HIDE_PAD_DM > dist) hi = m - 1; else return true; }
    return false;
  }
  // ---------- traffic: a bus queues behind a car in its lane and makes the lag up later (vehicles.js carsNow) ----------
  // Distances in dm along the shape. The drawn distance s.dd never runs ahead of the timetable, never goes backwards, stops
  // a gap short of a car ahead (same direction +-30 deg, < 2 m to the side, < 40 m ahead) and catches up at <= 1.3x.
  // Past 60 s of lag the bus passes cars that have pulled over to the curb for it (cars.js sets pull); never others.
  const LOOK_M = 40, LANE_M = 2, GAP_M = 2.5, CATCHUP = 1.3, MIN_CATCHUP_MPS = 7, MAX_LAG_S = 60, COS30 = 0.866;
  const ground = (du, dv, out) => { out[0] = (S2 * du + 2 * dv) / 2 * MPP; out[1] = (S2 * du - 2 * dv) / 2 * MPP; return out; };  // camera px -> E, N metres
  const G1 = [0, 0], G2 = [0, 0], G3 = [0, 0];
  function traffic(s, dT, T) {
    const dt = s.lastT == null ? 0 : T - s.lastT, vT = dt > 0 && s.lastDT != null ? Math.max(0, dT - s.lastDT) / 10 / dt : 0;  // timetable speed, m/s
    s.lastT = T; s.lastDT = dT;
    if (s.dd == null || dt <= 0 || dt > 5 || s.dd > dT) { s.dd = dT; s.lag = 0; return dT; }   // first frame, a time jump, or on schedule
    let next = Math.min(dT, s.dd + Math.max(vT * CATCHUP, MIN_CATCHUP_MPS) * dt * 10);
    if (carsNow.length) {
      ground(s.hx, s.hy, G1); const hl = Math.hypot(G1[0], G1[1]) || 1, bx = G1[0] / hl, by = G1[1] / hl;
      for (const c of carsNow) {
        ground(c.u - s.u, c.v - s.v, G2); const ahead = G2[0] * bx + G2[1] * by;
        if (ahead <= 0 || ahead > LOOK_M || Math.abs(G2[0] * by - G2[1] * bx) > LANE_M) continue;
        if (c.pull && s.lag >= MAX_LAG_S) continue;                               // pulled over to the curb for us: go past
        ground(c.hx, c.hy, G3); const cl = Math.hypot(G3[0], G3[1]) || 1;
        if ((G3[0] * bx + G3[1] * by) / cl < COS30) continue;                   // not going our way
        const room = ahead - (BUS_M + (c.len || 0) * MPP) / 2 - GAP_M;          // metres the bus may still move
        next = Math.min(next, s.dd + Math.max(0, room) * 10);
      }
    }
    s.dd = Math.max(s.dd, next);
    s.lag = dT - s.dd > 10 ? s.lag + dt : 0;                                    // seconds spent behind the timetable
    return s.dd;
  }
  function place(s, T) {                                // position + heading at service time T (seconds); false if not on the road
    const e = T + s.off - s.start, { arr, dep } = s.run, m = arr.length;
    if (e < 0 || e > s.run.dur) return false;
    let i = s.stop; if (i >= m || dep[i] > e) i = 0;
    while (i < m - 1 && arr[i + 1] <= e) i++;
    s.stop = i;
    let dist;
    if (e <= dep[i] || i === m - 1) { dist = s.dists[i]; s.next = i + 1 < m ? i + 1 : -1; }
    else { const k = (e - dep[i]) / ((arr[i + 1] - dep[i]) || 1); dist = s.dists[i] + (s.dists[i + 1] - s.dists[i]) * ease(Math.min(1, k)); s.next = i + 1; }
    s.eta = s.next >= 0 ? arr[s.next] - e : 0;
    dist = traffic(s, dist, T);                         // the timetable says `dist`; a car in front may hold the bus back
    s.seg = along(s, dist, C, true); s.u = C[0]; s.v = C[1];
    s.hidden = isHidden(s.shape.hid, dist);
    // heading from the line 7 m behind to 7 m ahead, turned back into a compass bearing on the ground
    along(s, dist - 70, A, false); along(s, dist + 70, B, false);
    const du = B[0] - A[0], dv = B[1] - A[1], L = Math.hypot(du, dv);
    if (L > 1) { s.hx = du / L; s.hy = dv / L; }
    if (du * du + dv * dv > 1) { const east = (S2 * du + 2 * dv) / 2, north = (S2 * du - 2 * dv) / 2;
      s.f = (Math.round(Math.atan2(east, north) / (2 * Math.PI) * N) % N + N) % N; }
    return true;
  }

  // ---------- drawing ----------
  const P0 = new OpenSeadragon.Point(0, 0), P1 = new OpenSeadragon.Point(1000, 0);
  function draw() {
    const dt = Math.min(200, performance.now() - lastDraw);
    lastDraw = performance.now();
    const it = item(); if (!it || !data || !img) return;
    if (cv.width !== Math.round(viewer.container.clientWidth * Math.min(2, devicePixelRatio || 1))) resize();
    const t = simNow();
    if (lastDraw - activeAt > ACTIVE_EVERY_MS) { activeAt = lastDraw; refreshActive(t); updateChip(t); }
    const p0 = it.imageToViewerElementCoordinates(P0), p1 = it.imageToViewerElementCoordinates(P1);
    const k = (p1.x - p0.x) / 1000, ox = p0.x - origin[0] * k, oy = p0.y - origin[1] * k;      // camera px -> css px
    const size = vehiclePx(BUS_M, k) * (SPRITE_META.VIEW / SPRITE_META.length);   // shared scale with the cars
    const sz = it.getContentSize(), bx0 = origin[0], by0 = origin[1], bx1 = bx0 + sz.x, by1 = by0 + sz.y;
    drawList.length = 0; busesNow.length = 0;
    for (const s of active) {
      s.vis = false; s.placed = place(s, t.sec);
      if (!s.placed) continue;
      const q = s.pub; q.u = s.u; q.v = s.v; q.hx = s.hx; q.hy = s.hy; busesNow.push(q);   // every bus on the road, also hidden / dwelling
      if (sel >= 0 && s.route !== sel && s !== followed) continue;            // a line is picked: only its buses
      if (s.u < bx0 || s.u > bx1 || s.v < by0 || s.v > by1 || !isPainted(s.u, s.v)) continue;   // only on the painting
      s.x = ox + s.u * k; s.y = oy + s.v * k; s.size = size;
      if (s.x < -size || s.y < -size || s.x > W + size || s.y > H + size) continue;
      const target = s.hidden ? 0 : 1;                                        // fade out behind buildings / trees
      s.alpha = s.alpha < 0 || reduced.matches ? target : s.alpha + Math.sign(target - s.alpha) * Math.min(Math.abs(target - s.alpha), dt / FADE_MS);
      s.vis = s.alpha > 0.5 || s === followed; drawList.push(s);              // hidden ones stay listed: drawn as silhouettes
    }
    drawList.sort((a, b) => a.y - b.y);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save(); clipToPainting(ctx, k, ox, oy);                               // lines, stops and buses end where the painting ends
    ctx.imageSmoothingEnabled = size * dpr < CELL * 0.95;                      // upscaled: crisp pixels, like the painting
    ctx.imageSmoothingQuality = 'medium';
    if (debugLines) {                                                          // ?buses=debug: every route line, for alignment checks
      if (!debugPaths) { debugPaths = [new Path2D(), new Path2D()]; for (const sh of data.shapes) shapePaths(sh, debugPaths[0], debugPaths[1]); }
      ctx.save(); ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy); ctx.lineWidth = 2 / k;   // magenta; faint where hidden
      ctx.strokeStyle = 'rgb(255,0,200)'; ctx.stroke(debugPaths[0]); ctx.globalAlpha = HIDDEN_LINE_ALPHA; ctx.stroke(debugPaths[1]); ctx.restore();
    }
    if (selGeo) drawLine(k, ox, oy, sz);
    for (const s of drawList) {
      const x0 = s.x - size / 2, y0 = s.y - size / 2;
      if (s.alpha > 0) {
        const slot = cell(s.route, s.f), sx = (slot % SLOTS) * CELL, sy = Math.floor(slot / SLOTS) * CELL;
        ctx.globalAlpha = s.alpha; ctx.drawImage(atlas, sx, sy, CELL, CELL, x0, y0, size, size);
      }
      if (s.alpha < 1) xray(s, x0, y0, size, 1 - s.alpha);                    // seen through the building / trees
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    const focus = hoverStop || (open?.isStop ? open : null);                  // hovered / tapped stop: full strength, on top
    if (focus && selGeo?.stops.includes(focus) && focus.vis) { drawStop(focus, 1, 6, data.routes[sel].color); ctx.globalAlpha = 1; }
    if (open) placeTip();
  }
  function loop() { raf = 0; if (!on || document.hidden || reduced.matches) return;
    if (performance.now() - lastDraw > 4) draw(); raf = requestAnimationFrame(loop); }
  function schedule() {
    cancelAnimationFrame(raf); raf = 0; clearInterval(stepTimer); stepTimer = 0;
    if (!on || document.hidden || !data) return;
    if (reduced.matches) { draw(); stepTimer = setInterval(draw, REDUCED_STEP_MS); }
    else raf = requestAnimationFrame(loop);
  }
  // keep buses glued to the painting while OSD animates (same tick as the tiles), and after resizes
  viewer.addHandler('animation', () => { if (on && data) draw(); });
  viewer.addHandler('resize', () => { if (on) { resize(); if (data) draw(); } });

  // ---------- tap / click: nearest bus under the pointer ----------
  function hit(x, y) {
    let best = null, bd = Infinity;
    for (const s of drawList) {
      if (!s.vis) continue;                             // fading / hidden buses cannot be tapped
      const r = s.size * 0.3 + TAP_SLOP, dx = x - s.x, dy = y - (s.y - s.size * 0.08), d = dx * dx + dy * dy;
      if (d < r * r && d < bd) { bd = d; best = s; }
    }
    return best;
  }
  // stops of the selected line are always tappable, also where a building or tree hides them (only buses are not)
  const coarse = matchMedia('(pointer: coarse)');
  function hitStop(x, y, r = 11) {
    if (!selGeo) return null;
    let best = null, bd = r * r;
    for (const st of selGeo.stops) { const d = (x - st.x) ** 2 + (y - st.y) ** 2; if (st.vis && d < bd) { bd = d; best = st; } }
    return best;
  }
  viewer.addHandler('canvas-click', e => {
    if (!on || !e.quick) return;
    const touch = e.pointerType === 'touch' || coarse.matches, x = e.position.x, y = e.position.y;
    const s = hitStop(x, y, 8) || hit(x, y) || hitStop(x, y, touch ? 22 : 12);   // 44 px targets on touch, 24 px with a mouse
    if (s) { e.preventDefaultAction = true; hoverStop = null; openTip(s); } else if (open) closeTip();
  });
  let hoverStop = null;
  let moveQueued = false, mx = 0, my = 0;
  viewer.canvas.addEventListener('pointermove', e => {
    if (!on || e.pointerType !== 'mouse') return;
    const r = viewer.canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top;
    if (!moveQueued) { moveQueued = true; requestAnimationFrame(() => {
      moveQueued = false;
      const st = hitStop(mx, my, 12), b = st ? null : hit(mx, my);
      viewer.canvas.style.cursor = st || b ? 'pointer' : '';
      if (st !== hoverStop) {                            // hovering a stop: full strength + its arrivals, until the pointer leaves
        if (hoverStop && open === hoverStop) closeTip();
        hoverStop = st; if (st && (!open || open.isStop)) openTip(st);
        draw();
      }
    }); }
  }, { passive: true });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (open) closeTip(); else if (panel.matches(':popover-open')) { panel.hidePopover(); linesBtn.focus(); }
  });

  function tipHTML(s) {
    if (s.isStop) return stopHTML(s);
    const r = data.routes[s.route], next = s.next >= 0 ? data.stops[s.stops[s.next]] : null;
    const eta = s.eta < 45 ? tx('now') : tx('min').replace('{n}', Math.round(s.eta / 60));
    return `<p class="bus-tip-head"><b class="bus-badge" style="--line:${r.color};--line-ink:${r.ink}">${esc(r.short)}</b> <span>→ ${esc(s.headsign || r.long)}</span></p>`
      + `<p class="bus-tip-name">${tx('line')} ${esc(r.short)} · ${esc(r.long)}</p>`
      + `<p>${next ? `${tx('next')}: <strong>${esc(next)}</strong> · ${eta}` : tx('end')}</p>`
      + `<p class="bus-tip-note">${demo ? tx('demoNote') : tx('notLive')}</p>`
      + `<p class="bus-tip-act"><button type="button" class="bus-follow" aria-pressed="${s === followed}">${s === followed ? tx('unfollow') : tx('follow')}</button></p>`;
  }
  let tipNext = -2, tipW = 0, tipH = 0;
  function openTip(s) { open = s; tipNext = -2; tip.hidden = false; placeTip(); }
  function closeTip() { if (open && open === followed) return; open = null; tip.hidden = true; }   // the followed bus keeps its card
  // ---------- follow camera (vehicles.js): the view glides after one bus; its card stays pinned to it ----------
  let followed = null;
  const followLabel = s => `${data.routes[s.route].short} · ${s.headsign || data.routes[s.route].long}`;
  function startFollow(s) {
    followed = s; open = s; tipNext = -2;
    follow.start({ label: followLabel(s), getPos: () => {
      if (followed !== s || !on || !states.has(s.key) || !s.placed) { if (followed === s) endFollow(); return null; }
      return [s.u - origin[0], s.v - origin[1]];                              // camera px -> image px
    } });
  }
  function endFollow() { const was = followed; followed = null; tipNext = -2; if (was && open === was && !(was.vis && states.has(was.key))) closeTip(); }
  tip.addEventListener('click', e => {
    if (!e.target.closest('.bus-follow') || !open || open.isStop) return;
    if (open === followed) { follow.stop(); endFollow(); } else startFollow(open);
    tipNext = -2; placeTip();
  });
  // the shared chip (Stop / Esc / dragging the map) ends following: notice it and unpin
  const followChip = document.getElementById('followChip');
  if (followChip) new MutationObserver(() => { if (followChip.hidden && followed) endFollow(); }).observe(followChip, { attributes: true, attributeFilter: ['hidden'] });
  function placeTip() {
    const s = open; if (!s.vis) { tip.style.visibility = 'hidden'; return; }
    tip.style.visibility = '';
    const key = s.isStop ? -Math.floor(simNow().sec / 30) : s.next * 100000 + Math.round(s.eta / 30) + (s === followed ? 0.5 : 0);
    if (key !== tipNext) { tipNext = key; tip.innerHTML = tipHTML(s); tipW = tip.offsetWidth; tipH = tip.offsetHeight; }
    const x = Math.min(W - tipW - 8, Math.max(8, s.x - tipW / 2));             // keep it on screen; flip below near the top
    let y = s.y - s.size * 0.32 - tipH - 4; if (y < 8) y = s.y + s.size * 0.3 + 4;
    tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  }

  // ---------- chip ----------
  function updateChip(t) {
    let text, btn = null;
    if (!on) text = '';
    else if (failed) text = tx('failed');
    else if (!data || !img) text = tx('loading');
    else {
      const n = running ? running.reduce((a, b) => a + b, 0) : 0;
      if (demo) { text = tx('demo').replace('{t}', hhmm(t.sec)).replace('{n}', n); btn = tx('live'); }
      else if (n) text = n === 1 ? tx('running1') : tx('running').replace('{n}', n);
      else {
        const d = day(t.ymd);
        text = d.first == null ? tx('noneDay') : t.sec < d.first ? tx('noneFirst').replace('{t}', hhmm(d.first)) : tx('noneEnded').replace('{t}', hhmm(d.last));
        btn = tx('showDemo');
      }
    }
    if (sel >= 0 && data && demo && running) text = tx('demo').replace('🚌 ', `🚌 ${data.routes[sel].short} · `).replace('{t}', hhmm(t.sec)).replace('{n}', running[sel]);
    else if (sel >= 0 && data && running) { const n = running[sel]; text = `🚌 ${data.routes[sel].short} · ${n ? tx('runningN').replace('{n}', n) : lineMeta(sel, simNow(), true)}`; }
    const key = text + '|' + btn + '|' + sel + '|' + getLang(); if (key === chipKey) return; chipKey = key;
    chip.hidden = !on; chipText.textContent = text;
    chipBtn.hidden = !btn; if (btn) chipBtn.textContent = btn;
    linesBtn.hidden = !data; linesBtn.textContent = tx('lines');
    if (panel.matches(':popover-open')) refreshPanel();
  }
  function demoDay(ymd) {                                // today if it has buses in the morning, else the next day that does
    for (let i = 0; i < 14; i++) { const y = ymdAdd(ymd, i), d = day(y); if (d.first != null && d.first < DEMO_START && d.last > DEMO_START) return y; }
    return ymd;
  }
  function setDemo(v, start = DEMO_START) {
    const t = clock(); demo = v ? { ymd: demoDay(t.ymd), sec: start, t0: performance.now() } : null; syncAt = -1e9;
    states.clear(); activeAt = -1e9; closeTip(); chipKey = ''; draw();
  }
  chipBtn.addEventListener('click', () => setDemo(!demo));

  // ---------- lines menu: every line with live counts + timetable; picking one shows only it (path, stops, buses) ----------
  const narrow = matchMedia('(width < 40rem)');
  const linesBtn = document.createElement('button'); linesBtn.type = 'button'; linesBtn.className = 'lines'; linesBtn.hidden = true;
  linesBtn.setAttribute('aria-controls', 'busLines'); linesBtn.setAttribute('aria-expanded', 'false');
  chip.insertBefore(linesBtn, chipBtn);
  const panel = document.createElement('section'); panel.id = 'busLines'; panel.className = 'bus-lines'; panel.popover = 'manual';
  panel.setAttribute('aria-labelledby', 'busLinesTitle');
  panel.innerHTML = `<header><h2 id="busLinesTitle"></h2><button type="button" class="btn bl-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <input class="bl-filter" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search">
    <p class="bl-day"></p><ul class="bl-list" role="list"></ul><p class="bl-credit"></p>`;
  (document.querySelector('.shell') || document.body).append(panel);
  const credit = document.createElement('span'); credit.className = 'bus-credit'; credit.hidden = true;   // CC BY-SA attribution while buses are on
  document.querySelector('.attr')?.append(credit);
  const setCredit = () => { credit.innerHTML = ` · <span class="long">${esc(tx('credit'))}</span><span class="short">${esc(tx('creditShort'))}</span>`; };

  function routeDay(ymd) {                              // per line: the day's trips grouped by direction (headsign), busiest first
    const d = day(ymd);
    if (!d.byRoute) {
      const maps = data.routes.map(() => new Map());
      for (const [start, ri] of d.list) {
        const pat = data.runs[ri].pat, m = maps[pat[1]]; let g = m.get(pat[2]);
        if (!g) m.set(pat[2], g = { head: pat[2], from: data.stops[pat[3][0]], trips: [] });
        g.trips.push([start, ri]);
      }
      d.byRoute = maps.map(m => [...m.values()].sort((a, b) => b.trips.length - a.trips.length));
    }
    return d.byRoute;
  }
  function headway(trips, sec) {                        // median gap (minutes) between departures from 20 min ago to 1 h ahead
    const w = []; for (const [st] of trips) if (st >= sec - 1200 && st <= sec + 3600) w.push(st);
    if (w.length < 3) return 0;
    const g = []; for (let i = 1; i < w.length; i++) g.push(w[i] - w[i - 1]); g.sort((a, b) => a - b);
    const m = g[g.length >> 1] / 60; return m <= 45 ? Math.max(1, Math.round(m)) : 0;
  }
  function lineMeta(r, t, short = false) {
    const dirs = routeDay(t.ymd)[r]; if (!dirs.length) return tx('noService');
    const parts = [], n = running?.[r] || 0;
    if (n && !short) parts.push(tx('runningN').replace('{n}', n));
    let next = Infinity, first = Infinity; for (const g of dirs) { first = Math.min(first, g.trips[0][0]); for (const [st] of g.trips) if (st >= t.sec) { next = Math.min(next, st); break; } }
    const hw = headway(dirs[0].trips, t.sec);
    if (hw) parts.push(tx('every').replace('{n}', hw));
    else if (next < Infinity) parts.push((next === first ? tx('firstAt') : tx('nextAt')).replace('{t}', hhmm(next)));
    else if (!n) parts.push(tx('done'));
    return parts.join(' · ');
  }
  function lineDetail(r, t) {
    const dirs = routeDay(t.ymd)[r]; if (!dirs.length) return `<p>${tx('noService')}</p>`;
    return dirs.slice(0, 3).map(g => {
      const nx = []; for (const [st] of g.trips) if (st >= t.sec && nx.push(hhmm(st)) >= 4) break;
      const hw = headway(g.trips, t.sec);
      return `<div class="bl-dir"><p class="bl-head">→ ${esc(g.head)} <small>${tx('from').replace('{s}', esc(g.from))}</small></p>`
        + `<p>${nx.length ? `${tx('nextDeps')}: <strong>${nx.join(' · ')}</strong>` : tx('noMore')}${hw ? ` · ${tx('every').replace('{n}', hw)}` : ''}</p>`
        + `<p class="bl-muted">${tx('firstLast').replace('{a}', hhmm(g.trips[0][0])).replace('{b}', hhmm(g.trips[g.trips.length - 1][0]))}</p></div>`;
    }).join('');
  }
  const norm = x => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  let searchIdx = null;
  function matches(r, q) {                              // line number, name or any stop it serves
    searchIdx ??= data.routes.map((R, i) => norm(`${R.short} ${R.long} ${[...new Set(data.pats.filter(p => p[1] === i).flatMap(p => p[3]))].map(x => data.stops[x]).join(' ')}`));
    if (/^\d+[a-z]?$/.test(q)) return norm(data.routes[r].short).startsWith(q);   // a line number: match numbers only
    return q.split(/\s+/).filter(Boolean).every(w => searchIdx[r].includes(w));
  }
  const dayLabel = t => new Intl.DateTimeFormat(getLang() === 'sq' ? 'sq' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(Date.UTC(Math.floor(t.ymd / 10000), Math.floor(t.ymd / 100) % 100 - 1, t.ymd % 100)) + `, ${hhmm(t.sec)}`;

  let built = false;
  function buildPanel() {
    const ul = panel.querySelector('.bl-list');
    const row = r => {
      const li = document.createElement('li'); li.className = 'bl-row'; li.dataset.r = r;
      const b = document.createElement('button'); b.type = 'button';
      if (r < 0) b.innerHTML = `<b class="bus-badge bl-all" aria-hidden="true">🚌</b><span class="bl-name"></span><span class="bl-meta"></span>`;
      else { const R = data.routes[r]; b.style.setProperty('--line', R.color); b.style.setProperty('--line-ink', R.ink);
        b.innerHTML = `<b class="bus-badge">${esc(R.short)}</b><span class="bl-name">${esc(R.long)}</span><span class="bl-meta"></span>`; }
      b.addEventListener('click', () => selectLine(sel === r ? -1 : r));
      const det = document.createElement('div'); det.className = 'bl-detail'; det.hidden = true;
      li.append(b, det); ul.append(li);
    };
    row(-1); data.routes.forEach((_, r) => row(r));
    const none = document.createElement('li'); none.className = 'bl-none'; none.hidden = true; ul.append(none);
    built = true;
  }
  function refreshPanel() {
    if (!data) return; if (!built) buildPanel();
    const t = simNow(), f = panel.querySelector('.bl-filter'), q = norm(f.value.trim());
    panel.querySelector('h2').textContent = tx('title');
    panel.querySelector('.bl-close').setAttribute('aria-label', tx('close'));
    f.placeholder = tx('filter'); f.setAttribute('aria-label', tx('filter'));
    panel.querySelector('.bl-day').textContent = tx('dayOf').replace('{d}', dayLabel(t)) + (demo ? ` · ${tx('demoNote')}` : '');
    panel.querySelector('.bl-credit').textContent = `${tx('credit')} · ${data.feed.version}`;
    let shown = 0;
    for (const li of panel.querySelectorAll('.bl-row')) {
      const r = +li.dataset.r, b = li.firstChild, ok = r < 0 ? !q : matches(r, q);
      li.hidden = !ok; if (ok && r >= 0) shown++;
      b.setAttribute('aria-pressed', String(r === sel));
      if (r < 0) { b.querySelector('.bl-name').textContent = tx('all'); b.querySelector('.bl-meta').textContent = tx('allMeta').replace('{n}', running ? running.reduce((a, c) => a + c, 0) : 0); }
      else b.querySelector('.bl-meta').textContent = lineMeta(r, t);
      const det = li.lastChild; det.hidden = r < 0 || r !== sel;
      if (!det.hidden) det.innerHTML = lineDetail(r, t);
    }
    const none = panel.querySelector('.bl-none'); none.hidden = shown > 0; none.textContent = tx('noMatch');
  }
  function openPanel(focus = true) {
    if (!data) return;
    refreshPanel(); if (!panel.matches(':popover-open')) panel.showPopover();
    if (focus) (matchMedia('(pointer: fine)').matches ? panel.querySelector('.bl-filter') : panel.querySelector('[aria-pressed="true"]'))?.focus({ preventScroll: true });
  }
  const closePanel = () => { if (panel.matches(':popover-open')) panel.hidePopover(); };
  panel.addEventListener('toggle', e => linesBtn.setAttribute('aria-expanded', String(e.newState === 'open')));
  linesBtn.addEventListener('click', () => (panel.matches(':popover-open') ? closePanel() : openPanel()));
  panel.querySelector('.bl-close').addEventListener('click', () => { closePanel(); linesBtn.focus(); });
  panel.querySelector('.bl-filter').addEventListener('input', refreshPanel);
  panel.querySelector('.bl-filter').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const li = [...panel.querySelectorAll('.bl-row:not([hidden])')].find(l => +l.dataset.r >= 0); if (li) selectLine(+li.dataset.r);
  });

  function lineGeo(r) {                                 // the line's path (both directions) as Path2D in camera px + its stops
    const pats = data.pats.filter(p => p[1] === r), vis = new Path2D(), hid = new Path2D(), stops = [], seen = new Set();
    const sz = item().getContentSize(), bx0 = origin[0], by0 = origin[1], bx1 = bx0 + sz.x, by1 = by0 + sz.y;
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const si of new Set(pats.map(p => p[0]))) {
      const sh = data.shapes[si]; shapePaths(sh, vis, hid);
      for (let i = 0; i < sh.n; i++) { const u = sh.u[i], v = sh.v[i];
        if (u >= bx0 && u <= bx1 && v >= by0 && v <= by1) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); } }
    }
    const tmp = { shape: null, seg: 0 };
    for (const p of pats) {
      tmp.shape = data.shapes[p[0]];
      p[3].forEach((st, i) => {
        if (seen.has(st)) return; seen.add(st); along(tmp, p[4][i], C, false);
        stops.push({ isStop: true, id: st, name: data.stops[st], route: r, u: C[0], v: C[1], x: 0, y: 0, size: 12, vis: false, hidden: isHiddenRaw(tmp.shape.hid, p[4][i]) });
      });
    }
    let centre = null, cd = Infinity; const cu = (u0 + u1) / 2, cv0 = (v0 + v1) / 2;   // the route point nearest the middle: where phones look
    for (const si of new Set(pats.map(p => p[0]))) { const sh = data.shapes[si];
      for (let i = 0; i < sh.n; i++) { const d = (sh.u[i] - cu) ** 2 + (sh.v[i] - cv0) ** 2; if (d < cd) { cd = d; centre = [sh.u[i], sh.v[i]]; } } }
    return { vis, hid, stops, bounds: [u0, v0, u1, v1], centre };
  }
  function shapePaths(sh, vis, hid) {                   // add a shape to the visible / hidden paths, split exactly at the stretches
    const cuts = [sh.s[0], ...sh.hid, sh.s[sh.n - 1]].filter((d, i, a) => d >= sh.s[0] && d <= sh.s[sh.n - 1] && (!i || d > a[i - 1]));
    const tmp = { shape: sh, seg: 0 };
    for (let c = 0; c < cuts.length - 1; c++) {
      const d0 = cuts[c], d1 = cuts[c + 1], p = isHiddenRaw(sh.hid, (d0 + d1) / 2) ? hid : vis;
      tmp.seg = along(tmp, d0, C, false); p.moveTo(C[0], C[1]);
      for (let i = tmp.seg + 1; i < sh.n && sh.s[i] < d1; i++) p.lineTo(sh.u[i], sh.v[i]);
      along(tmp, d1, C, false); p.lineTo(C[0], C[1]);
    }
  }
  function drawLine(k, ox, oy, sz) {
    const R = data.routes[sel], g = selGeo, px0 = ox + origin[0] * k, py0 = oy + origin[1] * k, pw = sz.x * k, ph = sz.y * k;
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();                   // only on the painting
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);             // draw the cached paths in camera px
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [path, a] of [[g.hid, HIDDEN_LINE_ALPHA], [g.vis, 1]]) {          // behind buildings / trees: same line, fainter
      // soft dark edge + light casing under the colour, so any route colour reads on trees, roofs and roads
      // light colours (8C lavender, 10A peach, 3A sky...) would vanish on a light casing: they get a dark one instead
      const light = R.ink !== '#ffffff';
      ctx.globalAlpha = (light ? 0.35 : 0.25) * a; ctx.lineWidth = 10 / k; ctx.strokeStyle = light ? '#fffdf5' : '#1d1a17'; ctx.stroke(path);
      ctx.globalAlpha = 0.85 * a; ctx.lineWidth = 7.5 / k; ctx.strokeStyle = light ? '#2b2622' : '#fffdf5'; ctx.stroke(path);
      ctx.globalAlpha = a; ctx.lineWidth = 4.5 / k; ctx.strokeStyle = R.color; ctx.stroke(path);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2; ctx.strokeStyle = R.color; ctx.fillStyle = '#fffdf5';
    for (const st of g.stops) {
      st.x = ox + st.u * k; st.y = oy + st.v * k;
      const inside = st.x >= px0 && st.x <= px0 + pw && st.y >= py0 && st.y <= py0 + ph && st.x > -10 && st.y > -10 && st.x < W + 10 && st.y < H + 10;
      st.vis = inside; if (inside) drawStop(st, st.hidden ? HIDDEN_LINE_ALPHA : 1, 4.5, R.color);
    }
    ctx.restore();
  }
  function drawStop(st, a, r, color) {
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.25 * a; ctx.fillStyle = '#1d1a17'; ctx.beginPath(); ctx.arc(st.x, st.y, r + 2, 0, 2 * Math.PI); ctx.fill();   // soft dark edge
    ctx.globalAlpha = a; ctx.fillStyle = '#fffdf5'; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(st.x, st.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  function fitLine() {
    const it = item(), [u0, v0, u1, v1] = selGeo.bounds; if (!(u1 > u0)) return;
    const pad = 0.08 * Math.max(u1 - u0, v1 - v0), Wc = viewer.container.clientWidth, Hc = viewer.container.clientHeight;
    let x = u0 - origin[0] - pad, y = v0 - origin[1] - pad, w = u1 - u0 + 2 * pad, h = v1 - v0 + 2 * pad;
    const top = document.querySelector('.bar')?.getBoundingClientRect().bottom || 0;
    const left = panel.matches(':popover-open') && !narrow.matches ? panel.getBoundingClientRect().right : 0;
    const fx = Math.min(0.6, left / Wc), fy = Math.min(0.4, top / Hc);                // keep the route clear of the panel and the top bar
    x -= w * fx / (1 - fx); w /= 1 - fx; y -= h * fy / (1 - fy); h /= 1 - fy;
    const rect = it.imageToViewportRectangle(x, y, w, h);
    viewer.viewport.fitBounds(rect);
    const minZ = it.imageToViewportZoom(narrow.matches ? 0.06 : 0.04);            // long lines on a phone: stay close enough to see buses
    if (viewer.viewport.getZoom() < minZ) { viewer.viewport.zoomTo(minZ); viewer.viewport.panTo(it.imageToViewportCoordinates(selGeo.centre[0] - origin[0], selGeo.centre[1] - origin[1])); }
  }
  function selectLine(r) {
    sel = r; selGeo = r >= 0 ? lineGeo(r) : null; hoverStop = null; closeTip(); chipKey = ''; if (r >= 0) track('line', { line: data.routes[r]?.short });
    if (narrow.matches && r >= 0) closePanel(); else if (panel.matches(':popover-open')) refreshPanel();
    if (r >= 0) fitLine();
    draw(); updateChip(simNow());
  }
  function stopHTML(st) {
    const R = data.routes[st.route], t = simNow(), out = [];
    for (const g of routeDay(t.ymd)[st.route]) {                              // next arrivals of this line here, per direction
      const times = [];
      for (const [start, ri] of g.trips) {
        const run = data.runs[ri], i = run.pat[3].indexOf(st.id); if (i < 0) continue;
        const at = start + run.arr[i]; if (at >= t.sec - 20) times.push(at); if (times.length >= 2 && start > t.sec) break;
      }
      times.sort((a, b) => a - b);
      if (times.length) out.push(`<p>→ ${esc(g.head)}: <strong>${times.slice(0, 2).map(a => a - t.sec < 45 ? tx('now') : a - t.sec < 3600 ? tx('min').replace('{n}', Math.round((a - t.sec) / 60)) : hhmm(a)).join(' · ')}</strong></p>`);
    }
    return `<p class="bus-tip-head"><b class="bus-badge" style="--line:${R.color};--line-ink:${R.ink}">${esc(R.short)}</b> <span>${esc(st.name)}</span></p>`
      + (out.length ? `<p class="bus-tip-name">${tx('arriving')}</p>${out.join('')}` : `<p class="bus-tip-name">${tx('noMore')}</p>`)
      + `<p class="bus-tip-note">${demo ? tx('demoNote') : tx('notLive')}</p>`;
  }

  // ---------- on / off ----------
  async function load() {
    if (data && img) return;
    loading ??= Promise.all([
      fetch(DATA).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => { data = decode(d); clock = tiranaClock(d.tz); }),
      new Promise((res, rej) => { const i = new Image(); i.decoding = 'async';
        i.onload = () => res(img = i); i.onerror = rej;
        const avif = window.__tt?.avif ?? false; i.src = `${SHEET}.${avif ? 'avif' : 'webp'}`; }),
    ]).catch(err => { failed = true; loading = null; console.warn('buses', err); });
    return loading;
  }
  async function setOn(v, fromUser = false) {
    on = v; button.setAttribute('aria-pressed', String(on)); cv.hidden = !on;
    credit.hidden = !on; setCredit();
    if (!on) { if (followed) { follow.stop(); endFollow(); } busesNow.length = 0; closeTip(); closePanel(); sel = -1; selGeo = null; schedule(); chip.hidden = true; chipKey = ''; viewer.canvas.style.cursor = ''; return; }
    resize(); chipKey = ''; updateChip(null);
    await load(); if (!on) return;
    if (failed) { updateChip(null); return; }
    if (arg && arg !== 'on' && !demo) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(arg); if (arg === 'demo' || m) setDemo(true, m ? m[1] * 3600 + m[2] * 60 : DEMO_START);
    }
    activeAt = -1e9; draw(); schedule();
    if (fromUser && !narrow.matches) openPanel(false);
  }
  button.hidden = false;
  button.addEventListener('click', () => setOn(!on, true));
  document.addEventListener('visibilitychange', () => { if (on) { activeAt = -1e9; schedule(); } });
  reduced.addEventListener?.('change', schedule);
  new MutationObserver(() => { chipKey = ''; tipNext = -2; setCredit();
    if (on && data) { updateChip(simNow()); if (open) placeTip(); if (panel.matches(':popover-open')) refreshPanel(); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  cv.hidden = true;
  if (arg) setOn(true);
  return window.__ttBuses = { setOn, selectLine, openPanel, get on() { return on; }, _debug: () => ({ followed: followed && { key: followed.key, alpha: +followed.alpha.toFixed(2), hidden: followed.hidden, x: Math.round(followed.x), y: Math.round(followed.y) }, busesNow: busesNow.length, sel, hiddenStops: selGeo?.stops.filter(s => s.hidden && s.x > 60 && s.y > 140 && s.x < W - 90 && s.y < H - 140).map(s => [Math.round(s.x), Math.round(s.y), s.name]) ?? [], selStops: selGeo?.stops.length ?? 0, selStopsOnScreen: selGeo?.stops.filter(s => s.x > 0 && s.y > 0 && s.x < W && s.y < H).length ?? 0, active: active.length, drawn: drawList.length, demo, now: data && simNow(), buses: drawList.filter(s => s.vis).map(s => [Math.round(s.x), Math.round(s.y), data.routes[s.route].short, s.key, +s.u.toFixed(1), +s.v.toFixed(1), +s.hx.toFixed(3), +s.hy.toFixed(3), +(s.lag || 0).toFixed(1), +((s.lastDT - s.dd) / 10 || 0).toFixed(1)]) }) };
}
