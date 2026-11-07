import { track } from './analytics.js';
import { GEO } from './geo.js';
// Live aircraft over Tiny Tirana. Data: /api/planes (dev_server.py locally, deploy/planes-worker.js in production),
// which mirrors free ADS-B feeds (adsb.lol, adsb.fi). ?planes=demo replaces it with a labelled synthetic sky.
//
// Geometry: the map is one orthographic camera looking NW at 45 deg. Raising a point only moves it straight up the
// screen, so a plane is drawn at its altitude-shifted position with a thin stem down to its shadow on the ground.
// Real altitudes would put cruising jets far off the painting, so the drawn height is compressed (labels show the truth).

const FT = 0.3048, KT = 0.514444, SQUASH = Math.SQRT1_2;           // ground plane is squashed by sin(45 deg) on screen
const GROUND_ELLIPSOID = GEO.ground, AIRPORT = GEO.airport;   // ellipsoidal metres of the 3D model (city ground ~146 m; Rinas ~74 m)
const POLL_MS = 12000,   // positions are extrapolated in between; 12 s keeps a crowd's Worker requests low
      MAX_EXTRAP_S = 25, GRACE_S = 30, CONVERGE_S = 4;

const visHeight = agl => agl <= 150 ? agl : 150 + 450 * (1 - Math.exp(-(agl - 150) / 2500));   // true near the ground, ~600 m max drawn height
const groundElev = (lat, lon) => (Math.hypot(lat - AIRPORT.lat, (lon - AIRPORT.lon) * 0.75) < 0.03 ? AIRPORT.elev : GROUND_ELLIPSOID);

const livery = hex => [...String(hex)].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;

function advance(lat, lon, track, metres) {
  const r = track * Math.PI / 180;
  return [lat + metres * Math.cos(r) / 111320, lon + metres * Math.sin(r) / (111320 * Math.cos(lat * Math.PI / 180))];
}

// A small top-view airliner, nose pointing to +x. Drawn once, reused for every plane.
const SPRITE = `<svg viewBox="-20 -18 40 36" aria-hidden="true"><g stroke="#3b2e27" stroke-width="1.1" stroke-linejoin="round">
  <path d="M-15 0 L-12 -1.6 L12 -2.2 Q18 -1.6 19 0 Q18 1.6 12 2.2 L-12 1.6 Z" fill="#fbfaf6"/>
  <path d="M2 -2 L-5 -16 L-1 -16 L8 -2 Z M2 2 L-5 16 L-1 16 L8 2 Z" fill="#eef0f2"/>
  <path d="M-11 -1.5 L-16 -7 L-13.5 -7 L-8 -1.5 Z M-11 1.5 L-16 7 L-13.5 7 L-8 1.5 Z" fill="#eef0f2"/>
  <path d="M-15 -0.6 L-17.5 -0.6 L-17 0.6 L-15 0.6Z" fill="#e8a33d"/></g></svg>`;

export function initPlanes({ viewer, item, imgAt, t, lang, button, chip }) {
  const demo = new URLSearchParams(location.search).get('planes') === 'demo';
  const planes = new Map();           // hex -> state
  let on = true, timer = 0, raf = 0, lastSource = null, lastCount = 0;
  // Planes live in their own layer, positioned with transforms. (As OSD overlays, every updateOverlay() forced a full
  // tile redraw each frame, and centring used a stale element size, so planes drifted when zooming.)
  const layer = document.createElement('div'); layer.className = 'planes-layer';
  (viewer.overlaysContainer || viewer.canvas).append(layer);

  function makeEl(p) {
    const el = document.createElement('div'); el.className = 'plane'; el.tabIndex = 0; el.setAttribute('role', 'img');
    el.innerHTML = `<i class="stem"></i><i class="shadow">${SPRITE}</i><b class="sprite"></b><span class="tip"></span>`;
    new OpenSeadragon.MouseTracker({ element: el, clickHandler: e => { e.preventDefaultAction = true; if (el.classList.toggle('open')) track('plane', { demo }); } });
    el.hidden = !on; layer.append(el);
    return el;
  }
  function tipText(p) {
    const m = Math.round(p.alt_ft * FT), alt = p.ground ? t('onGround') : `${Math.round(p.alt_ft).toLocaleString()} ft · ${m.toLocaleString()} m`;
    const name = p.flight || p.reg || p.hex.toUpperCase();
    return `<strong>${name}</strong>${p.type ? ` <small>${p.type}</small>` : ''}<br>${alt} · ${Math.round(p.gs_kt * 1.852)} km/h${demo ? `<br><em>${t('demo')}</em>` : ''}`;
  }

  // ---------- data ----------
  async function poll() {
    if (!on || document.hidden) return;
    let data;
    try { data = demo ? demoSky() : await (await fetch('/api/planes', { cache: 'no-store' })).json(); } catch { data = { planes: [] }; }
    const now = performance.now() / 1000, seen = new Set();
    for (const p of data.planes || []) {
      seen.add(p.hex);
      let s = planes.get(p.hex);
      const fix = { lat: p.lat, lon: p.lon, t: now - (p.seen || 0) };
      if (!s) { s = { el: makeEl(p) }; planes.set(p.hex, s); }
      Object.assign(s, { p, fix, lastSeen: now });      // the drawn position (s.disp) is NOT reset: frame() steers it
      s.el.querySelector('.tip').innerHTML = tipText(p);
      s.el.setAttribute('aria-label', (p.flight || p.hex) + ', ' + (p.ground ? t('onGround') : Math.round(p.alt_ft) + ' ft'));
    }
    for (const [hex, s] of planes) if (!seen.has(hex) && now - s.lastSeen > GRACE_S) { s.el.remove(); planes.delete(hex); }   // keep flying through short gaps
    lastSource = demo ? 'demo' : data.source; lastCount = planes.size; updateChip();
    if (planes.size && !raf) raf = requestAnimationFrame(frame);
  }

  // ---------- drawing ----------
  // place(): screen position + sizes from the CURRENT viewport. It runs inside OSD's 'update-viewport' (fired while OSD
  // draws the tiles, so planes never lag a zooming map by a frame) and after each motion step while the map is still.
  function place(s, it) {
    const q = s.pos; if (!q) return;
    const z = it.viewportToImageZoom(viewer.viewport.getZoom(true));
    const pt = viewer.viewport.pixelFromPoint(it.imageToViewportCoordinates(q.ax, q.ay), true);
    const span = Math.min(110, Math.max(26, 245 * z));                          // ~36 m wingspan at true scale, clamped
    s.el.style.transform = `translate3d(${pt.x.toFixed(2)}px, ${pt.y.toFixed(2)}px, 0)`;
    s.el.style.setProperty('--span', `${span.toFixed(2)}px`); s.el.style.setProperty('--stem', `${((q.gy - q.ay) * z).toFixed(2)}px`);
  }
  function placeAll() { const it = item(); if (it && on) for (const s of planes.values()) place(s, it); }
  viewer.addHandler('update-viewport', placeAll);
  window.__ttPlanes = planes;                                                  // debug / QA hook
  function frame() {
    raf = 0;
    const it = item(); if (!it || !on) return;
    const now = performance.now() / 1000;
    const script = demo ? new Map(demoSky().planes.map(d => [d.hex, d])) : null;
    for (const s of planes.values()) {
      if (script?.has(s.p.hex)) { const d = script.get(s.p.hex); s.p = d; s.fix = { lat: d.lat, lon: d.lon, t: now }; }
      const { p, fix } = s;
      const dt = Math.min(MAX_EXTRAP_S, Math.max(0, now - fix.t));
      const [tlat, tlon] = p.ground && p.gs_kt < 3 ? [fix.lat, fix.lon] : advance(fix.lat, fix.lon, p.track, p.gs_kt * KT * dt);   // where it should be now
      let altM = p.ground ? 0 : p.alt_ft * FT + (p.vs_fpm * FT / 60) * dt;
      // dead reckoning that never flies backwards: the drawn plane keeps flying along its track; a new radar fix only
      // changes how fast (ahead -> slower, behind -> faster) and nudges it sideways, converging in ~CONVERGE_S
      const fdt = Math.min(0.1, Math.max(0, now - (s.lastFrame ?? now))); s.lastFrame = now;
      if (!s.disp || script) s.disp = { lat: tlat, lon: tlon };
      else {
        const kx = 111320 * Math.cos(tlat * Math.PI / 180), ex = (tlon - s.disp.lon) * kx, ny = (tlat - s.disp.lat) * 111320;   // error, metres E / N
        const r = p.track * Math.PI / 180, tx = Math.sin(r), ty = Math.cos(r), v = p.gs_kt * KT;
        const along = ex * tx + ny * ty, crossE = ex - along * tx, crossN = ny - along * ty;
        if (Math.hypot(ex, ny) > 3000 || (p.ground && p.gs_kt < 3)) s.disp = { lat: tlat, lon: tlon };       // far off (new data) or parked
        else {
          const fwd = Math.max(0, v * fdt + along * fdt / CONVERGE_S), k = Math.min(1, fdt / CONVERGE_S);
          s.disp = { lat: s.disp.lat + (fwd * ty + crossN * k) / 111320, lon: s.disp.lon + (fwd * tx + crossE * k) / kx };
        }
      }
      const { lat, lon } = s.disp;
      s.el.style.opacity = now - s.lastSeen > GRACE_S - 5 ? String(Math.max(0, (GRACE_S - (now - s.lastSeen)) / 5)) : '';   // fade before it goes
      const g = groundElev(lat, lon), agl = p.ground ? 0 : Math.max(0, altM + 45 - g);    // alt_ft ~ MSL; +45 m geoid
      const [gx, gy] = imgAt(lat, lon, g), [ax, ay] = imgAt(lat, lon, g + visHeight(agl));
      const [hx, hy] = imgAt(...advance(lat, lon, p.track, 60), g);
      const phi = Math.atan2((hy - gy) / SQUASH, hx - gx) * 180 / Math.PI;        // heading in the (un-squashed) ground plane
      // 3D sprite: 32 headings pre-rendered from the map camera (render/sprites), one livery per aircraft
      s.el.style.setProperty('--f', String(Math.round(((p.track % 360) + 360) % 360 / 11.25) % 32));
      s.el.style.setProperty('--row', String(livery(p.hex)));
      s.el.style.setProperty('--rot', `${phi}deg`);
      s.el.classList.toggle('grounded', p.ground);
      s.pos = { ax, ay, gy }; place(s, it);
    }
    if (planes.size) raf = requestAnimationFrame(frame);
  }

  function updateChip() {
    button.setAttribute('aria-pressed', String(on));
    const n = lastCount;
    chip.hidden = !on;
    chip.textContent = !on ? '' : lastSource === 'demo' ? t('planesDemo').replace('{n}', n) : n === 1 ? t('planesLive1') : n ? t('planesLive').replace('{n}', n) : t('planesNone');
  }
  function setOn(v) {
    on = v;
    for (const s of planes.values()) s.el.hidden = !on;
    clearInterval(timer); if (on) { poll(); timer = setInterval(poll, POLL_MS); }
    updateChip();
  }
  button.hidden = false;
  button.addEventListener('click', () => setOn(!on));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on) poll(); });
  setOn(true);
  return { refreshLabels: () => { for (const s of planes.values()) s.el.querySelector('.tip').innerHTML = tipText(s.p); updateChip(); } };
}

// ---------- demo sky: clearly labelled, deterministic, loops ----------
function demoSky() {
  const T = Date.now() / 1000, lerp = (a, b, k) => a + (b - a) * k, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const KM_LAT = 111.32, KM_LON = 111.32 * Math.cos(41.4 * Math.PI / 180);
  const out = [];
  // Runway 17/35 at Rinas (OSM): south end (35 threshold) and north end.
  const S = [41.4024, 19.7222], N = [41.4270, 19.7189];
  const along = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const runwayKm = Math.hypot((N[0] - S[0]) * KM_LAT, (N[1] - S[1]) * KM_LON);   // ~2.75 km
  const track35 = (Math.atan2((N[1] - S[1]) * KM_LON, (N[0] - S[0]) * KM_LAT) * 180 / Math.PI + 360) % 360;
  // 1) DEPARTURE (150 s loop): hold 15 s, take-off roll 35 s (0 -> 150 kt over ~2 km), climb out north at 2,000 fpm
  { const t = (T % 150);
    let lat, lon, alt = 0, gs = 0, ground = true;
    if (t < 15) { [lat, lon] = S; }
    else if (t < 50) { const u = (t - 15) / 35, d = 0.75 * runwayKm * u * u; [lat, lon] = along(S, N, d / runwayKm); gs = 150 * u; }
    else { const u = t - 50, d = 0.75 * runwayKm + 0.077 * u; [lat, lon] = along(S, N, d / runwayKm); gs = 150 + 0.4 * u; alt = 2000 * u / 60 * 1.2; ground = false; }
    out.push({ hex: 'demo05', flight: 'DEMOTKO', type: 'A320', lat, lon, alt_ft: alt, ground, gs_kt: gs, track: track35, vs_fpm: ground ? 0 : 2400, seen: 0 }); }
  // 2) ARRIVAL to runway 35 (200 s loop): 3-degree final from 12 km out, touchdown, roll out and slow down
  { const t = T % 200, finalKm = 12;
    const [lat0, lon0] = [S[0] - finalKm * Math.cos(track35 * Math.PI / 180) / KM_LAT, S[1] - finalKm * Math.sin(track35 * Math.PI / 180) / KM_LON];
    let lat, lon, alt, gs, ground = false;
    if (t < 150) { const u = t / 150; [lat, lon] = [lerp(lat0, S[0], u), lerp(lon0, S[1], u)]; alt = (1 - u) * finalKm * 1000 * Math.tan(3 * Math.PI / 180) / 0.3048; gs = 155; }
    else { const u = clamp((t - 150) / 50, 0, 1), d = runwayKm * 0.7 * (1 - (1 - u) * (1 - u)); [lat, lon] = along(S, N, d / runwayKm); alt = 0; gs = 140 * (1 - u) + 15; ground = true; }
    out.push({ hex: 'demo01', flight: 'DEMOARR', type: 'B738', lat, lon, alt_ft: alt, ground, gs_kt: gs, track: track35, vs_fpm: ground ? 0 : -800, seen: 0 }); }
  // 3) low pass over the city centre, heading east (180 s loop) — speed matches the motion
  { const k = ((T + 40) % 180) / 180, lon0 = 19.74, lon1 = 19.90;
    const gs = (lon1 - lon0) * KM_LON * 1000 / 180 / 0.514444;
    out.push({ hex: 'demo02', flight: 'DEMOLOW', type: 'ATR72', lat: 41.322, lon: lerp(lon0, lon1, k), alt_ft: 5500, ground: false, gs_kt: gs, track: 90, vs_fpm: 0, seen: 0 }); }
  // 4) high overflight north-west -> south-east (360 s loop)
  { const k = ((T + 100) % 360) / 360, a = [41.42, 19.68], b = [41.24, 19.92];
    const km = Math.hypot((b[0] - a[0]) * KM_LAT, (b[1] - a[1]) * KM_LON), gs = km * 1000 / 360 / 0.514444;
    const tr = (Math.atan2((b[1] - a[1]) * KM_LON, (b[0] - a[0]) * KM_LAT) * 180 / Math.PI + 360) % 360;
    out.push({ hex: 'demo03', flight: 'DEMOHI', type: 'A21N', lat: lerp(a[0], b[0], k), lon: lerp(a[1], b[1], k), alt_ft: 36000, ground: false, gs_kt: gs, track: tr, vs_fpm: 0, seen: 0 }); }
  // 5) parked at the terminal
  out.push({ hex: 'demo04', flight: 'DEMOPRK', type: 'E195', lat: 41.4146, lon: 19.7203, alt_ft: 0, ground: true, gs_kt: 0, track: 260, vs_fpm: 0, seen: 0 });
  return { source: 'demo', planes: out };
}
