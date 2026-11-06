// An isometric-slab globe on <canvas> (orthographic).
// Land is a raised slab: a hard shadow on the sea, a terracotta side, an ivory top.
// Maps are little isometric blocks, stacked per city in launch order.
// It draws only while something changes, and colours come from the page's CSS tokens.

const { geoOrthographic, geoPath, geoGraticule10 } = window.d3;
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = t => 1 - (1 - t) ** 3;
const bounce = t => { // ease out, then one soft landing bounce
  if (t < 0.72) return easeOut(t / 0.72) * 1.04;
  return 1.04 - 0.04 * Math.sin(((t - 0.72) / 0.28) * Math.PI / 2);
};
const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
const unit = (lon, lat) => { const l = lon * DEG, p = lat * DEG, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; };
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const ZMIN = 0.85, ZMAX = 2.8, IDLE_MS = 2600, AUTO_DEG_PER_MS = 0.0042, ARC = 4 * DEG;

// ---------- geometry: every polygon ring and border line as unit vectors, with a bounding cap ----------
function parts(g) {
  const out = [];
  const add = (type, coordinates) => {
    const pts = type === 'Polygon' ? coordinates[0] : coordinates;
    const c = [0, 0, 0];
    for (const [x, y] of pts) { const u = unit(x, y); c[0] += u[0]; c[1] += u[1]; c[2] += u[2]; }
    const n = Math.hypot(...c) || 1; c[0] /= n; c[1] /= n; c[2] /= n;
    let minDot = 1;
    for (const [x, y] of pts) { const u = unit(x, y); minDot = Math.min(minDot, u[0] * c[0] + u[1] * c[1] + u[2] * c[2]); }
    const r = Math.acos(clamp(minDot, -1, 1)) / DEG;
    const rings = (type === 'Polygon' ? coordinates : [coordinates]).map(ring => {
      const v = new Float64Array(ring.length * 3);
      ring.forEach(([x, y], i) => { const u = unit(x, y); v[i * 3] = u[0]; v[i * 3 + 1] = u[1]; v[i * 3 + 2] = u[2]; });
      return v;
    });
    // hidden when its whole cap is past the horizon
    out.push({ g: { type, coordinates }, rings, c, hideBelow: r >= 88 ? -2 : Math.cos((91 + r) * DEG) });
  };
  const walk = g => {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    else if (g.type === 'FeatureCollection') g.features.forEach(f => walk(f.geometry));
    else if (g.type === 'Feature') walk(g.geometry);
    else if (g.type === 'Polygon' || g.type === 'LineString') add(g.type, g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(c => add('Polygon', c));
    else if (g.type === 'MultiLineString') g.coordinates.forEach(c => add('LineString', c));
  };
  walk(g);
  return out;
}

// ---------- a lean orthographic projector ----------
// Three dot products per point instead of d3's per-point trig and clipping (about 10x faster on 50m coastlines).
// Where a ring dips behind the globe, its hidden stretch is walked along the limb, so fills stay right.
// d3 winds outer rings clockwise: a ring that wraps the view axis clockwise holds the centre of the view (fine);
// one that wraps it the other way holds the far side of the view, and that polygon is handed to d3 instead.
// Rings are closed with a line, not closePath(): in Chrome closePath() costs more the longer the Path2D gets.
let buf = new Float64Array(1 << 17);
function projectRing(v, B, hole, k0) { // writes x, y (unit disc) into buf from k0; returns the end, or -1 for d3
  const c0 = B[0], c1 = B[1], c2 = B[2], e0 = B[3], e1 = B[4], e2 = B[5], n0 = B[6], n1 = B[7], n2 = B[8], n = v.length / 3;
  if (buf.length < k0 + n * 2 + 400) { const nb = new Float64Array((k0 + n * 2 + 400) * 2); nb.set(buf); buf = nb; }
  let k = k0, hidden = false, wind = 0, lx = 0, ly = 0, started = false;
  let prevZ = 0, prevX = 0, prevY = 0, limbA = 0, emittedA = 0;
  const emit = (x, y) => {
    if (started && (ly < 0) !== (y < 0)) { const xi = lx + (x - lx) * (-ly / (y - ly)); if (xi > 0) wind += y > ly ? 1 : -1; }
    started = true; lx = x; ly = y;
    if (k + 2 > buf.length) { const nb = new Float64Array(buf.length * 2); nb.set(buf); buf = nb; }
    buf[k++] = x; buf[k++] = y;
  };
  const limbTo = (a, final) => { // along the limb the short way, a point every ARC
    let d = a - limbA; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    limbA += d;
    let gap = limbA - emittedA;
    while (Math.abs(gap) >= ARC) { emittedA += Math.sign(gap) * ARC; emit(Math.cos(emittedA), Math.sin(emittedA)); gap = limbA - emittedA; }
    if (final && gap !== 0) { emittedA = limbA; emit(Math.cos(limbA), Math.sin(limbA)); }
  };
  for (let i = 0; i < n; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], zz = v[i * 3 + 2];
    const z = x * c0 + y * c1 + zz * c2, px = x * e0 + y * e1 + zz * e2, py = x * n0 + y * n1 + zz * n2;
    if (z >= 0) {
      if (i > 0 && prevZ < 0) { const t = prevZ / (prevZ - z); limbTo(Math.atan2(prevY + (py - prevY) * t, prevX + (px - prevX) * t), true); }
      emit(px, py);
    } else {
      hidden = true;
      const a = Math.atan2(py, px);
      if (i === 0) { limbA = emittedA = a; emit(Math.cos(a), Math.sin(a)); }
      else if (prevZ >= 0) {
        const t = prevZ / (prevZ - z), ca = Math.atan2(prevY + (py - prevY) * t, prevX + (px - prevX) * t);
        limbA = emittedA = ca; emit(Math.cos(ca), Math.sin(ca)); limbTo(a, false);
      } else limbTo(a, false);
    }
    prevZ = z; prevX = px; prevY = py;
  }
  if (prevZ < 0) limbTo(limbA, true);
  if (k > k0) { const x = buf[k0], y = buf[k0 + 1]; if ((ly < 0) !== (y < 0)) { const xi = lx + (x - lx) * (-ly / (y - ly)); if (xi > 0) wind += y > ly ? 1 : -1; } }
  return hidden && (hole ? wind < 0 : wind > 0) ? -1 : k;
}
const ends = [];
function projectPolys(list, path, B, cx, cy, R, viaD3) {
  for (const p of list) {
    if (p.c[0] * B[0] + p.c[1] * B[1] + p.c[2] * B[2] < p.hideBelow) continue;
    ends.length = 0;
    let k = 0;
    for (let r = 0; r < p.rings.length && k >= 0; r++) { k = projectRing(p.rings[r], B, r > 0, k); ends.push(k); }
    if (k < 0) { viaD3(p.g); continue; }
    let s0 = 0;
    for (const e of ends) {
      if (e - s0 >= 6) {
        path.moveTo(cx + buf[s0] * R, cy - buf[s0 + 1] * R);
        for (let i = s0 + 2; i < e; i += 2) path.lineTo(cx + buf[i] * R, cy - buf[i + 1] * R);
        path.lineTo(cx + buf[s0] * R, cy - buf[s0 + 1] * R);
      }
      s0 = e;
    }
  }
}
function projectLines(list, path, B, cx, cy, R) {
  const [c0, c1, c2, e0, e1, e2, n0, n1, n2] = B;
  for (const p of list) {
    if (p.c[0] * c0 + p.c[1] * c1 + p.c[2] * c2 < p.hideBelow) continue;
    const v = p.rings[0], n = v.length / 3;
    let prevZ = -1, prevX = 0, prevY = 0;
    for (let i = 0; i < n; i++) {
      const x = v[i * 3], y = v[i * 3 + 1], zz = v[i * 3 + 2];
      const z = x * c0 + y * c1 + zz * c2, px = x * e0 + y * e1 + zz * e2, py = x * n0 + y * n1 + zz * n2;
      if (z >= 0) {
        if (i === 0) path.moveTo(cx + px * R, cy - py * R);
        else if (prevZ < 0) { const t = prevZ / (prevZ - z); path.moveTo(cx + (prevX + (px - prevX) * t) * R, cy - (prevY + (py - prevY) * t) * R); path.lineTo(cx + px * R, cy - py * R); }
        else path.lineTo(cx + px * R, cy - py * R);
      } else if (i > 0 && prevZ >= 0) { const t = prevZ / (prevZ - z); path.lineTo(cx + (prevX + (px - prevX) * t) * R, cy - (prevY + (py - prevY) * t) * R); }
      prevZ = z; prevX = px; prevY = py;
    }
  }
}
const closeWithLine = P => { let sx = 0, sy = 0; return {
  moveTo(x, y) { sx = x; sy = y; P.moveTo(x, y); }, lineTo(x, y) { P.lineTo(x, y); },
  closePath() { P.lineTo(sx, sy); }, arc(x, y, r, a0, a1) { P.arc(x, y, r, a0, a1); } }; };

export function createGlobe(root, { onPick, onHover, onNeedDetail, start = [-20, 28], kinds }) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const proj = geoOrthographic().clipAngle(90).precision(0.7);
  const graticule = geoGraticule10();
  const geo = {}; // coarse (110m) first, then fine (50m): { land, borders }
  const view = { lon: start[0], lat: start[1], k: 1 };
  const box = { w: 0, h: 0, cx: 0, cy: 0, R0: 100, dpr: 1 };
  const overlays = { tip: root.querySelector('.tip'), callout: root.querySelector('.callout'), flag: root.querySelector('.flag') };

  let stacks = [], drawn = [], selected = null, hover = null, listHover = null, opened = null; // opened: stack fanned out by a click
  const FAN_K = 2.4;   // zoom at which every stack fans out on its own
  let fly = null, inertia = null, follow = null, userHoldUntil = 0, lastInteraction = -1e9;
  let raf = 0, last = 0, autoTimer = 0, onScreen = true, autoEnabled = true;
  let drag = null, pinch = null;
  const ripples = [];

  // ---------- colours from CSS tokens (light-dark() resolves on a probe element) ----------
  const probe = document.createElement('i'); probe.hidden = true; root.append(probe);
  const resolve = expr => { probe.style.color = ''; probe.style.color = expr; return getComputedStyle(probe).color; };
  let C = {}, P = {};
  function readColours() {
    for (const n of ['sea', 'sea-hi', 'sea-deep', 'land', 'land-side', 'land-shadow', 'coast', 'border', 'grat', 'atmo', 'shade', 'spec', 'rim', 'ground'])
      C[n] = resolve(`var(--${n})`);
    for (const n of ['atmo', 'shade', 'spec', 'ground']) C[`${n}0`] = resolve(`color-mix(in oklch, var(--${n}) 0%, transparent)`);
    C.halo = resolve('var(--card)');
    P = {};
    for (const [k, token] of Object.entries({ ...kinds, ours: '--accent' })) {
      P[k] = {
        top: resolve(`color-mix(in oklch, var(${token}), white 34%)`),
        left: resolve(`var(${token})`),
        right: resolve(`color-mix(in oklch, var(${token}), black 24%)`),
        edge: resolve(`color-mix(in oklch, var(${token}), black 48%)`),
        ring: resolve(`color-mix(in oklch, var(${token}) 70%, transparent)`),
        glow: resolve(`color-mix(in oklch, var(${token}) 26%, transparent)`),
      };
    }
    baseKey = '';
  }

  // ---------- sizing ----------
  function measure() {
    const r = canvas.getBoundingClientRect();
    box.w = r.width; box.h = r.height;
    box.dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(box.w * box.dpr), H = Math.round(box.h * box.dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    // keep the globe clear of anything floating over the canvas foot (the wave panel)
    let bottom = box.h;
    for (const el of root.parentElement.querySelectorAll('[data-globe-avoid]')) {
      const e = el.getBoundingClientRect();
      if (e.height && e.top < r.bottom && e.bottom > r.top && e.left < r.right && e.right > r.left) bottom = Math.min(bottom, e.top - r.top);
    }
    const availH = Math.max(120, bottom);
    box.cx = box.w / 2; box.cy = availH / 2;
    box.R0 = Math.max(60, (Math.min(box.w, availH) / 2) * 0.86);
    request();
  }

  // ---------- data ----------
  function setGeo(level, topo) {
    const t = window.topojson;
    geo[level] = {
      land: parts(t.feature(topo, topo.objects.land)),
      borders: parts(t.mesh(topo, topo.objects.countries, (a, b) => a !== b)),
    };
    baseKey = '';
    request();
  }
  // maps: [{ lon, lat, key, kind, ours, at }] -> one stack per city, oldest block at the bottom
  function setMaps(list) {
    const byKey = new Map();
    for (const m of list) {
      let s = byKey.get(m.key);
      if (!s) { s = { key: m.key, lon: m.lon, lat: m.lat, all: [], items: [] }; byKey.set(m.key, s); }
      s.all.push(m); m.stack = s;
    }
    for (const s of byKey.values()) {
      s.all.sort((a, b) => a.at - b.at || (a.ours ? 1 : 0) - (b.ours ? 1 : 0));
      s.v = unit(s.lon, s.lat);
    }
    stacks = [...byKey.values()];
    request();
  }
  function setShown(test) {
    for (const s of stacks) s.items = s.all.filter(test);
    request();
  }

  // ---------- camera ----------
  const centerVec = () => unit(view.lon, view.lat);
  function basis() {
    const l = view.lon * DEG, p = view.lat * DEG, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p);
    return [cp * cl, cp * sl, sp, -sl, cl, 0, -sp * cl, -sp * sl, cp]; // view direction, east, north
  }
  function flyTo(lon, lat, k = view.k, ms) {
    inertia = null;
    lat = clamp(lat, -70, 70); k = clamp(k, ZMIN, ZMAX);
    if (reduceMQ.matches) { view.lon = lon; view.lat = lat; view.k = k; fly = null; request(); return; }
    const dLon = wrap180(lon - view.lon), dist = Math.hypot(dLon, lat - view.lat);
    const dur = ms ?? clamp(520 + dist * 6, 650, 1500);
    fly = { t0: performance.now(), dur, lon0: view.lon, lat0: view.lat, k0: view.k, dLon, dLat: lat - view.lat, k1: k, dip: Math.min(0.22, dist / 500) };
    request();
  }
  function stepFly(now) {
    const t = clamp((now - fly.t0) / fly.dur, 0, 1), e = easeInOut(t);
    view.lon = fly.lon0 + fly.dLon * e; view.lat = fly.lat0 + fly.dLat * e;
    view.k = (fly.k0 + (fly.k1 - fly.k0) * e) * (1 - fly.dip * Math.sin(Math.PI * e)); // a little zoom-out mid-flight
    if (t >= 1) fly = null;
  }
  // a soft camera that drifts toward a target (the wave replay steers it)
  function setFollow(lonlat, k) { follow = lonlat ? { lon: lonlat[0], lat: clamp(lonlat[1], -60, 60), k } : null; if (follow) request(); }
  function stepFollow(dt, now) {
    if (now < userHoldUntil || reduceMQ.matches) return false;
    const a = 1 - Math.exp(-dt / 650);
    const dLon = wrap180(follow.lon - view.lon), dLat = follow.lat - view.lat;
    view.lon += dLon * a; view.lat += dLat * a;
    if (follow.k) view.k += (follow.k - view.k) * a;
    return Math.abs(dLon) + Math.abs(dLat) > 0.05 || (follow.k && Math.abs(follow.k - view.k) > 0.002);
  }
  const canAuto = now => autoEnabled && onScreen && !document.hidden && !reduceMQ.matches && !selected && !follow
    && !drag && !pinch && !hover && now - lastInteraction > IDLE_MS;
  function touched() {
    lastInteraction = performance.now();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(request, IDLE_MS + 40);
  }

  // ---------- frame loop: runs only while something changes ----------
  function request() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(48, now - last) : 16; last = now;
    let moving = false;
    if (fly) { stepFly(now); moving = true; }
    else if (inertia) {
      const f = Math.exp(-dt / 320);
      view.lon -= inertia.vx * dt; view.lat = clamp(view.lat + inertia.vy * dt, -80, 80);
      inertia.vx *= f; inertia.vy *= f;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.0006) inertia = null; else moving = true;
    } else if (follow) moving = stepFollow(dt, now);
    else if (canAuto(now)) { view.lon -= dt * AUTO_DEG_PER_MS; moving = true; }
    const fans = stepFans(dt), fx = effectsActive(now) || fans;
    draw(now, moving || fx);
    if (moving || fx) request(); else last = 0;
  }

  // ---------- drawing ----------
  // The globe goes to an offscreen layer that is re-projected only when the view changes;
  // hovering, pulsing and dropping blocks just copy it and redraw the blocks on top.
  const base = document.createElement('canvas'), bctx = base.getContext('2d');
  let baseKey = '';
  function drawBase(R) {
    const { w, h, dpr, cx, cy } = box, c = bctx;
    const g = geo.full || geo.coarse;
    const key = `${view.lon.toFixed(3)} ${view.lat.toFixed(3)} ${R.toFixed(2)} ${w} ${h} ${dpr} ${g === geo.full ? 'F' : g ? 'C' : '-'}`;
    if (key === baseKey) return;
    baseKey = key;
    if (base.width !== canvas.width || base.height !== canvas.height) { base.width = canvas.width; base.height = canvas.height; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    // the floating globe's soft floor shadow, then the atmosphere
    if (view.k < 1.6) {
      const gy = cy + R * 1.08, gr = c.createRadialGradient(cx, gy, 0, cx, gy, R * 0.9);
      gr.addColorStop(0, C.ground); gr.addColorStop(1, C.ground0);
      c.save(); c.translate(cx, gy); c.scale(1, 0.16); c.translate(-cx, -gy);
      c.fillStyle = gr; c.beginPath(); c.arc(cx, gy, R * 0.9, 0, TAU); c.fill(); c.restore();
    }
    const atmo = c.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.16);
    atmo.addColorStop(0, C.atmo); atmo.addColorStop(1, C.atmo0);
    c.fillStyle = atmo; c.beginPath(); c.arc(cx, cy, R * 1.16, 0, TAU); c.fill();

    // sea, lit from the top left
    const sea = c.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R);
    sea.addColorStop(0, C['sea-hi']); sea.addColorStop(0.55, C.sea); sea.addColorStop(1, C['sea-deep']);
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fillStyle = sea; c.fill(); c.clip();
    const lineW = clamp(R / 420, 0.5, 1);
    c.beginPath(); geoPath(proj, c)(graticule); c.strokeStyle = C.grat; c.lineWidth = lineW; c.stroke();

    if (g) {
      // land as a raised slab: hard shadow on the sea, terracotta side, ivory top
      const B = basis(), land = new Path2D(), borders = new Path2D();
      projectPolys(g.land, land, B, cx, cy, R, geoPath(proj, closeWithLine(land)));
      projectLines(g.borders, borders, B, cx, cy, R);
      const lip = clamp(R / 95, 2, 7);
      c.translate(0, lip * 2.1); c.fillStyle = C['land-shadow']; c.fill(land);
      c.translate(0, -lip * 1.1); c.fillStyle = C['land-side']; c.fill(land);
      c.translate(0, -lip); c.fillStyle = C.land; c.fill(land);
      c.strokeStyle = C.coast; c.lineWidth = lineW; c.stroke(land);
      c.strokeStyle = C.border; c.lineWidth = lineW * 0.8; c.setLineDash([2, 2.5]); c.stroke(borders); c.setLineDash([]);
    }
    // a soft highlight and a darker limb
    const shade = c.createRadialGradient(cx - R * 0.4, cy - R * 0.46, R * 0.02, cx - R * 0.1, cy - R * 0.1, R * 1.25);
    shade.addColorStop(0, C.spec); shade.addColorStop(0.3, C.spec0); shade.addColorStop(0.62, C.shade0); shade.addColorStop(1, C.shade);
    c.fillStyle = shade; c.fillRect(cx - R, cy - R, R * 2, R * 2);
    c.restore();
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.strokeStyle = C.rim; c.lineWidth = 1; c.stroke();
  }
  function draw(now, live) {
    const { w, h, dpr, cx, cy } = box;
    if (!w || !h) return;
    const R = box.R0 * view.k;
    if (onNeedDetail && R >= 230) { onNeedDetail(); onNeedDetail = null; }
    proj.scale(R).translate([cx, cy]).rotate([-view.lon, -view.lat]);
    drawBase(R);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStacks(R, now, live);
  }

  // a 2:1 isometric block standing on (x, y), the centre of its footprint
  function cube(x, y, w, hgt, p, outline) {
    const a = w / 2, b = w / 4;
    ctx.beginPath(); ctx.moveTo(x - a, y - hgt); ctx.lineTo(x, y + b - hgt); ctx.lineTo(x, y + b); ctx.lineTo(x - a, y); ctx.closePath();
    ctx.fillStyle = p.left; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y + b - hgt); ctx.lineTo(x + a, y - hgt); ctx.lineTo(x + a, y); ctx.lineTo(x, y + b); ctx.closePath();
    ctx.fillStyle = p.right; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - a, y - hgt); ctx.lineTo(x, y - b - hgt); ctx.lineTo(x + a, y - hgt); ctx.lineTo(x, y + b - hgt); ctx.closePath();
    ctx.fillStyle = p.top; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - a, y - hgt); ctx.lineTo(x, y - b - hgt); ctx.lineTo(x + a, y - hgt); ctx.lineTo(x + a, y); ctx.lineTo(x, y + b); ctx.lineTo(x - a, y); ctx.closePath();
    ctx.lineJoin = 'round';
    if (outline) { ctx.strokeStyle = C.halo; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke();
  }
  function ellipse(x, y, rx) { ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.5); ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.restore(); }
  function ring(x, y, rx, color, width, alpha = 1) {
    ellipse(x, y, rx); // path stays in place after restore; stroking here keeps the line width even
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.restore();
  }
  function disc(x, y, rx, color, alpha = 1) {
    ellipse(x, y, rx);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }

  // Ground offsets for a fanned-out stack: a compact isometric grid around the city, centred on it.
  const GRID = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2], [-2, 0], [0, -2]];
  function fanOffsets(n) {
    const g = GRID.slice(0, n), mx = g.reduce((a, c) => a + c[0], 0) / n, my = g.reduce((a, c) => a + c[1], 0) / n;
    return g.map(([a, b]) => [a - mx, b - my]);
  }
  const fanTarget = s => s.items.length > 1 && (view.k >= FAN_K || opened === s || (selected && s.items.includes(selected))) ? 1 : 0;
  function stepFans(dt) {
    let moving = false;
    for (const s of stacks) {
      const t = fanTarget(s), f = s.fan ?? 0;
      if (reduceMQ.matches) s.fan = t;
      else if (Math.abs(t - f) > 0.002) { s.fan = f + (t - f) * Math.min(1, dt / 90); moving = true; }
      else s.fan = t;
    }
    return moving;
  }

  function drawStacks(R, now, live) {
    const cv = centerVec(), size = clamp(R / 27, 7.5, 16);
    drawn = [];
    for (const s of stacks) {
      if (!s.items.length) continue;
      const d = s.v[0] * cv[0] + s.v[1] * cv[1] + s.v[2] * cv[2];
      if (d < 0.03) continue;
      const [x, y] = proj([s.lon, s.lat]);
      drawn.push({ s, x, y, alpha: smooth(0.03, 0.2, d) });
    }
    drawn.sort((a, b) => a.y - b.y); // farther up the screen first, so lower stacks overlap them
    const anchors = new Map();
    for (const D of drawn) {
      const { s, x, y } = D;
      const hot = hover?.s === s || listHover?.stack === s;
      ctx.globalAlpha = D.alpha;
      const ours = s.items.some(m => m.ours);
      const w = ours ? size * 1.4 : size, hgt = w * 0.58;
      D.w = w; D.cubes = [];
      // on the ground: a soft shadow, Tiny Tirana's glow, the selection halo, launch ripples
      disc(x, y + w * 0.08, w * 0.85, C.ground);
      if (ours) {
        const pulse = live && !reduceMQ.matches ? (now % 2200) / 2200 : 0.45;
        disc(x, y, w * (1.1 + pulse * 0.9), P.ours.glow, 1 - pulse * 0.7);
        ring(x, y, w * (1.1 + pulse * 0.9), P.ours.ring, 1.4, 1 - pulse);
      }
      const sel = selected && selected.stack === s && s.items.includes(selected) ? selected : null;
      if (sel) { const p = P[sel.ours ? 'ours' : sel.kind]; disc(x, y, w * 1.5, p.glow); ring(x, y, w * 1.5, p.ring, 1.6); }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        if (rp.s !== s) continue;
        const t = (now - rp.t0) / 1300;
        if (t >= 1) { ripples.splice(i, 1); continue; }
        if (t < 0) continue;
        for (const lag of [0, 0.18]) {
          const u = clamp((t - lag) / (1 - lag), 0, 1);
          if (u > 0 && u < 1) ring(x, y, w * (0.8 + easeOut(u) * 3.4), P[rp.kind].left, 2 * (1 - u) + 0.4, (1 - u) * 0.95);
        }
      }
      let top = y;
      const f = easeOut(s.fan ?? 0), n = s.items.length, offs = fanOffsets(n), fw = w * (1 + 0.35 * f), gap = fw * 1.3;
      const list = s.items.map((m, i) => {
        const [ga, gb] = offs[i];
        const fx = x + (ga - gb) * gap * 0.5, fy = y + (ga + gb) * gap * 0.25;          // isometric ground grid
        return { m, i, cx: x + (fx - x) * f, cy: (y - i * hgt) + (fy - (y - i * hgt)) * f };
      });
      if (f > 0.5) list.sort((a, b) => a.cy - b.cy);                                       // fanned: back to front
      if (f > 0.02) disc(x, y, gap * 0.25 * f, C.ground);                                   // the city's true spot
      D.fanned = f > 0.5;
      for (const c of list) {
        const { m, i } = c;
        let yy = c.cy - (hot && f < 0.5 ? 2 : 0), a = 1;
        if (m.popAt && !reduceMQ.matches) { // dropped in from above
          const t = (now - m.popAt) / 560;
          if (t < 0) a = 0;
          else if (t < 1) { yy -= (1 - bounce(t)) * (24 + i * 2); a = clamp(t * 3.5, 0, 1); }
        }
        if (a <= 0) continue;
        const cw = w + (fw - w) * f, ch = hgt * cw / w;
        ctx.globalAlpha = D.alpha * a;
        if (f > 0.02) disc(c.cx, yy + cw * 0.06, cw * 0.62 * f, C.ground);
        cube(c.cx, yy, cw, ch, P[m.ours ? 'ours' : m.kind], m === sel || listHover === m || hover?.m === m && D.fanned);
        const ctop = yy - ch - cw / 4;
        if (f < 0.5) top = Math.min(top, ctop);
        D.cubes.push({ m, x: c.cx, w: cw, top: ctop, bottom: yy + cw / 4 });
        anchors.set(m, [c.cx, ctop, D.alpha]);
      }
      if (f > 0.5) { top = Math.min(...D.cubes.map(c => c.top)); for (const c of D.cubes) anchors.set(c.m, [c.x, top - 4, D.alpha]); }
      // a count badge on a closed stack of several maps
      if (n > 1 && f < 0.3) {
        const bx = x + w * 0.55, by = top + 2, label = String(n);
        ctx.globalAlpha = D.alpha * (1 - f / 0.3);
        ctx.font = '700 10px ui-rounded, system-ui, sans-serif';
        const bw = Math.max(15, ctx.measureText(label).width + 9);
        ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - 8, bw, 15, 7.5); ctx.fillStyle = C.badge || '#2b2420'; ctx.fill();
        ctx.fillStyle = C.badgeInk || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, bx, by);
      }
      if (ours) anchors.set('ours-ground', [x, y + w * 0.55, D.alpha]);
      D.top = top;
    }
    ctx.globalAlpha = 1;
    placeOverlays(anchors);
  }
  function effectsActive(now) {
    for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 >= 1300) ripples.splice(i, 1); // incl. ones on the far side
    if (ripples.length) return true;
    if (reduceMQ.matches) return false;
    for (const s of stacks) for (const m of s.items) if (m.popAt && now - m.popAt < 600) return true;
    return false;
  }

  // ---------- DOM labels that ride on the globe ----------
  function place(el, at, show) {
    if (!el) return;
    const on = !!(show && at && at[2] > 0.25);
    if (el.dataset.show !== String(on)) el.dataset.show = String(on);
    if (on) el.style.translate = `${Math.round(at[0])}px ${Math.round(at[1])}px`;
  }
  function placeOverlays(anchors) {
    const oursM = stacks.flatMap(s => s.items).find(m => m.ours);
    // Tiny Tirana's flag hangs below its block (over Greece, where no maps sit yet)
    place(overlays.flag, anchors.get('ours-ground'), oursM && selected !== oursM && hover?.m !== oursM);
    place(overlays.callout, selected && anchors.get(selected), !!selected);
    place(overlays.tip, hover && anchors.get(hover.m), !!hover && hover.m !== selected);
  }

  // ---------- picking: the block under the pointer, front stacks first ----------
  function pick(x, y, slop) {
    for (let i = drawn.length - 1; i >= 0; i--) {
      const D = drawn[i];
      if (!D.cubes?.length || D.alpha < 0.3) continue;
      // fanned: each block is its own target (front-most first); stacked: the whole column, then the block at that height
      if (D.fanned) {
        const hits = D.cubes.filter(c => Math.abs(x - c.x) <= c.w / 2 + slop && y >= c.top - slop && y <= c.bottom + slop);
        if (hits.length) { hits.sort((p, q) => q.bottom - p.bottom); return { s: D.s, m: hits[0].m }; }
        continue;
      }
      const a = D.w / 2 + slop;
      if (x < D.x - a || x > D.x + a || y < D.top - slop || y > D.y + D.w / 4 + slop) continue;
      let best = D.cubes[D.cubes.length - 1];
      for (const c of D.cubes) if (y >= c.top && y <= c.bottom) best = c;
      return { s: D.s, m: best.m, closedStack: D.s.items.length > 1 };
    }
    return null;
  }
  function setHover(hit) {
    if (hover?.m === hit?.m) return;
    hover = hit;
    root.dataset.hot = hit ? 'true' : 'false';
    onHover?.(hit?.m ?? null);
    request();
  }

  // ---------- pointer: drag to spin (with a little inertia), pinch or wheel to zoom ----------
  const pts = new Map();
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const degPerPx = () => 57.2958 / (box.R0 * view.k);
  const held = () => { touched(); userHoldUntil = performance.now() + 2500; };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    fly = null; inertia = null; held();
    if (pts.size === 1) {
      const [x, y] = pts.get(e.pointerId);
      drag = { x0: x, y0: y, lon0: view.lon, lat0: view.lat, moved: false, samples: [[performance.now(), x, y]], type: e.pointerType };
    } else if (pts.size === 2) {
      const [[ax, ay], [bx, by]] = [...pts.values()];
      pinch = { d0: Math.hypot(ax - bx, ay - by) || 1, k0: view.k, mx: (ax + bx) / 2, my: (ay + by) / 2, lon0: view.lon, lat0: view.lat };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [[ax, ay], [bx, by]] = [...pts.values()];
      view.k = clamp((pinch.k0 * Math.hypot(ax - bx, ay - by)) / pinch.d0, ZMIN, ZMAX);
      const s = degPerPx();
      view.lon = pinch.lon0 - ((ax + bx) / 2 - pinch.mx) * s;
      view.lat = clamp(pinch.lat0 + ((ay + by) / 2 - pinch.my) * s, -80, 80);
      held(); request();
      return;
    }
    if (drag) {
      const [x, y] = p, dx = x - drag.x0, dy = y - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > (drag.type === 'mouse' ? 3 : 7)) { drag.moved = true; root.dataset.dragging = ''; setHover(null); }
      if (drag.moved) {
        const s = degPerPx();
        view.lon = drag.lon0 - dx * s; view.lat = clamp(drag.lat0 + dy * s, -80, 80);
        drag.samples.push([performance.now(), x, y]); if (drag.samples.length > 6) drag.samples.shift();
        held(); request();
      }
      return;
    }
    if (e.pointerType === 'mouse') { touched(); setHover(pick(p[0], p[1], 3)); }
  });
  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    const d = drag; drag = null; delete root.dataset.dragging;
    if (e.type === 'pointercancel') return;
    if (!d.moved) {
      const [x, y] = local(e);
      const hit = pick(x, y, d.type === 'mouse' ? 3 : 12);
      if (hit?.closedStack) { // first click on a stack of several maps: fan it out so each block can be picked
        opened = hit.s; flyTo(hit.s.lon, hit.s.lat, Math.max(view.k, 1.8)); setHover(null); request();
      } else if (hit) onPick?.(hit.m);
      else if (opened) { opened = null; request(); }
      return;
    }
    const sm = d.samples, a = sm[0], b = sm[sm.length - 1], dt = b[0] - a[0];
    if (!reduceMQ.matches && dt > 0 && performance.now() - b[0] < 80) {
      const s = degPerPx();
      inertia = { vx: ((b[1] - a[1]) / dt) * s, vy: ((b[2] - a[2]) / dt) * s };
    }
    request();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) setHover(null); });
  canvas.addEventListener('wheel', e => {
    // where the page itself scrolls, a plain wheel scrolls the page; a trackpad pinch (ctrl) still zooms
    if (document.documentElement.scrollHeight > innerHeight + 4 && !e.ctrlKey) return;
    e.preventDefault();
    fly = null; inertia = null; touched();
    view.k = clamp(view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), ZMIN, ZMAX);
    request();
  }, { passive: false });

  readColours();
  darkMQ.addEventListener('change', () => { readColours(); request(); });
  new ResizeObserver(measure).observe(root);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) request(); }).observe(root);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) request(); });

  return {
    setGeo, setMaps, setShown, flyTo,
    follow: setFollow,
    select(m, { fly: doFly = true } = {}) {
      selected = m; if (m) touched();
      if (m && doFly) {
        // crowded spots (several maps in this city, or other cities close by) get a closer look so blocks don't collide
        const near = stacks.filter(o => o.items.length && Math.abs(o.lat - m.lat) < 7 && Math.abs((o.lon - m.lon) * Math.cos(m.lat * Math.PI / 180)) < 7).length;
        const crowded = (m.stack?.items.length ?? 1) > 1 || near > 2;
        flyTo(m.lon, m.lat - (crowded ? 1 : 3), crowded ? clamp(Math.max(view.k, 3.2), ZMIN, ZMAX) : clamp(Math.max(view.k, 1.3), ZMIN, 1.8));
      }
      request();
    },
    highlight(m) { listHover = m; request(); },
    pop(m, at = performance.now()) {
      m.popAt = at;
      if (!reduceMQ.matches && m.stack) ripples.push({ s: m.stack, kind: m.ours ? 'ours' : m.kind, t0: at + 140 });
      request();
    },
    setAuto(on) { autoEnabled = on; touched(); request(); },
  };
}
