import { makeCars } from './cars.js';
import { GEO } from './geo.js';
import { clipToPainting } from './vehicles.js';

// City life: lake birds (Muscovy ducks with ducklings, some waddling on the lakeside grass; coots, little and great crested
// grebes, a swan pair) on Tirana Lake and the little park pool, migrating flocks crossing the sky in spring and autumn
// (migrants.js), and a light trickle of toy cars on the main roads (cars.js). One canvas over the map, no DOM per animal.
// Animals are always on; the button toggles only the cars. ?cars=0 leaves the cars out, ?migrate=now forces a flock.
// Data (post/life_bake.py): life/water.json, CAMERA px (the canvas origin is subtracted here, so it survives a bigger map):
//   fields: per lake, metres from each ground-plane cell to the nearest shore OR water the camera can't see (shore trees hang
//           over the edge; depth test = post/occlusion.py visible_uv), so birds steering up it never swim under the trees;
//   shore:  patches of open, visible grass by the lake.   Sprites: render/sprites/make_life.mjs -> life/birds.{avif,webp}.
// Geometry: one orthographic camera looking NW, tilted 45 deg. On the ground, screen-down distances are squashed by sin 45,
// so motion runs in GROUND px (u, g = v / SQ) where distances are true, and goes back to screen with v = g * SQ.

const SQ = Math.SQRT1_2, DEG = 180 / Math.PI;
const Z_MIN = 0.2, Z_FULL = 0.28;                       // hidden below Z_MIN (too small to read), fades in up to Z_FULL
const MAX_DT = 0.1;
const WITH_CARS = new URLSearchParams(location.search).get('cars') !== '0';
const DEBUG = new URLSearchParams(location.search).has('lifedebug');
// sheet rows (render/sprites/life.html species order) and toy size, metres per model unit (a unit is about one body length)
const B_MUSCOVY = 0, B_DUCKLING = 1, B_COOT = 2, B_LGREBE = 3, B_CGREBE = 4, B_SWAN = 5, B_WALK = 6;
const SIZE = [2.4, 1.3, 1.8, 1.45, 2.3, 3.7];            // toy scale, ~2.5-3x true size (a Muscovy ~2.5 m on screen)
const WALK_SIZE = 2.0, POOL = 0.8;                         // waddlers on the grass; birds on the small park pool
const BIRD_MIN_PXM = 7;                                    // css px per metre at least (zoomed out), so a duck still reads at 0.4
const NEAR = 38;                                           // m from the shore: most birds stay closer than this

export async function initLife({ viewer, item, origin, button, avif, base = 'life/' }) {
  const [water, meta] = await Promise.all(['water.json', 'birds.json'].map(f => fetch(base + f).then(r => r.json())));
  const img = name => { const i = new Image(); i.src = base + name + (avif ? '.avif' : '.webp'); return i.decode().then(() => i); };
  const [sheet, carData] = await Promise.all([img('birds'),
    WITH_CARS ? Promise.all([fetch(base + 'roads.json').then(r => r.json()), fetch(base + 'cars.json').then(r => r.json()), img('cars')]) : null]);
  const PXM = 1 / GEO.camera.mpp;                         // camera px per metre
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let seed = 7;                                          // mulberry32: same scene every time
  const rnd = () => { let t = (seed += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------------- birds ----------------
  // Swimmers live on the GROUND plane of a water field (u, g = v / SQ), steering up the distance-to-shore gradient (the field
  // already treats water hidden under shore trees as shore). Three kinds of group: a line (hen + ducklings, a swan pair: they
  // follow the leader's wake), a loose flock (coots drifting round a shared centre) and lone divers (grebes vanish and pop up).
  const fields = water.fields.map(w => { const b = atob(w.d), d = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) d[i] = b.charCodeAt(i); let max = 0; for (const x of d) max = Math.max(max, x); return { ...w, d, max }; });
  function depth(f, u, g) {                                   // metres to shore at ground point (u, g)
    const x = (u - f.u0) / f.cell, y = (g - f.g0) / f.cell, i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= f.w - 1 || j >= f.h - 1) return 0;
    const fx = x - i, fy = y - j, k = j * f.w + i, d = f.d;
    return (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + f.w] * (1 - fx) + d[k + f.w + 1] * fx) * fy;
  }
  const TRAIL = 256, STEP = 0.25 * PXM;                       // leader's path, one point every 25 cm
  const groups = [], birds = [], walkers = [];
  let birdGrow = 1;                                          // > 1 when zoomed out (BIRD_MIN_PXM floor): sprites AND spacing grow
  const RINGS = 12, rings = new Float32Array(RINGS * 4); let ringAt = 0;   // dive splashes: x, g, t0, size
  const ring = (x, g, sz) => { const o = (ringAt++ % RINGS) * 4; rings[o] = x; rings[o + 1] = g; rings[o + 2] = simT; rings[o + 3] = sz; };
  // spawn spots: mostly near where people look (the piers, the dam end; baked as f.spots) and within NEAR m of the shore
  let spawnN = 0;
  function spot(f, need, sep) {
    const near = f.spots && f.spots.length && (spawnN++ % 3) !== 2;                  // 2 in 3 by a pier / the dam, 1 in 3 anywhere along the shore
    for (let tries = 0; tries < 900; tries++) {
      let i, j;
      if (near && tries < 600) { const S = f.spots[Math.floor(rnd() * f.spots.length)], r = rnd() * 110 * PXM, t = rnd() * 6.3;
        i = Math.round((S[0] + Math.cos(t) * r - f.u0) / f.cell); j = Math.round((S[1] + Math.sin(t) * r - f.g0) / f.cell);
        if (i < 0 || j < 0 || i >= f.w || j >= f.h) continue; }
      else { i = Math.floor(rnd() * f.w); j = Math.floor(rnd() * f.h); }
      const dd = f.d[j * f.w + i];
      if (dd < need || (f.max > NEAR + 10 && dd > NEAR + (tries > 700 ? 15 : 0))) continue;
      const u = f.u0 + i * f.cell, g = f.g0 + j * f.cell;
      if (groups.some(o => o.f === f && Math.hypot(o.x - u, o.y - g) < sep * PXM)) continue;
      return [u, g];
    }
    return null;
  }
  // kind: 'line' | 'flock' | 'dive'. members: [row, size metres/unit]
  function addGroup(f, kind, members, speed, scale = 1) {
    const margin = Math.min(9, f.max * 0.55), at = spot(f, Math.min(f.max - 1, margin + 6), 45); if (!at) return;
    const [u, g] = at, th = rnd() * 2 * Math.PI, trail = new Float32Array(2 * TRAIL);
    for (let k = 0; k < TRAIL; k++) { const q = (TRAIL - k) % TRAIL; trail[2 * q] = u - Math.cos(th) * STEP * k; trail[2 * q + 1] = g - Math.sin(th) * STEP * k; }
    const G = { f, kind, margin, hard: Math.min(3.5, f.max * 0.3) + (members[0][1] * scale) * 0.25, speed, x: u, y: g, th, om: 0, sp: 0, ph: rnd() * 10, trail, head: 0, acc: 0, members: [],
                dive: 0, timer: 4 + rnd() * 8 };
    members.forEach(([row, size], k) => {
      const b = { G, row, size: size * scale, k, x: u, y: g, th, a: 1, ox: 0, oy: 0, rad: 2 + rnd() * 5, w: (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.08), p: rnd() * 6.3 };
      G.members.push(b); birds.push(b);
    });
    groups.push(G);
  }
  const fs = [...fields].sort((a, b) => b.area - a.area), lake = fs.find(f => /Tiran/.test(f.name || '')) || fs[0];
  if (lake) {
    for (const n of [5, 4, 6, 3]) addGroup(lake, 'line', [[B_MUSCOVY, SIZE[0]], ...Array(n).fill([B_DUCKLING, SIZE[1]])], 0.7);   // hens + ducklings
    for (const n of [3, 2, 4, 2]) addGroup(lake, 'line', Array.from({ length: n }, (_, i) => [B_MUSCOVY, SIZE[0] * (1 - i * 0.04)]), 0.9);   // adults
    for (const n of [5, 4, 6, 4]) addGroup(lake, 'flock', Array(n).fill([B_COOT, SIZE[2]]), 0.6);   // coots, loose
    for (let i = 0; i < 5; i++) addGroup(lake, 'dive', [[B_LGREBE, SIZE[3]]], 0.7);                 // little grebes
    for (let i = 0; i < 2; i++) addGroup(lake, 'dive', [[B_CGREBE, SIZE[4]]], 0.8);                 // great crested grebes
    addGroup(lake, 'line', [[B_CGREBE, SIZE[4]], [B_CGREBE, SIZE[4] * 0.95]], 0.8);
    addGroup(lake, 'line', [[B_SWAN, SIZE[5]], [B_SWAN, SIZE[5] * 0.94]], 0.6);                     // swan pairs
    addGroup(lake, 'line', [[B_SWAN, SIZE[5]], [B_SWAN, SIZE[5] * 0.96]], 0.5);
  }
  for (const f of fields) {                                                                      // the other lakes and ponds of the city
    if (f === lake) continue;
    if (f.area >= 20000 && f.max >= 15) {                  // a lake (Paskuqan, Farka, Liqeni i Thatë...): a few Muscovy groups and coots
      const n = Math.max(1, Math.min(3, Math.round(f.area / 80000)));
      for (let i = 0; i < n; i++) addGroup(f, 'line', i % 2 ? [[B_MUSCOVY, SIZE[0]], [B_MUSCOVY, SIZE[0] * 0.95]] : [[B_MUSCOVY, SIZE[0]], ...Array(3 + i).fill([B_DUCKLING, SIZE[1]])], 0.7);
      for (let i = 0; i < Math.max(1, n - 1); i++) addGroup(f, 'flock', Array(4).fill([B_COOT, SIZE[2]]), 0.6);
      if (f.area > 150000) addGroup(f, 'dive', [[B_LGREBE, SIZE[3]]], 0.7);
    } else if (f.max >= 10 && f.area >= 1000 && f.area < 20000) {   // a park pool / pond: one hen with ducklings
      addGroup(f, 'line', [[B_MUSCOVY, SIZE[0]], ...Array(3).fill([B_DUCKLING, SIZE[1]])], 0.5, POOL);
    }
  }
  // Muscovies waddling on the grass by the lake: hop between baked open-ground points, pause to peck
  for (const [i, P] of (water.shore || []).entries()) {
    const n = i % 2 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const j = Math.floor(rnd() * P.u.length);
      walkers.push({ P, x: P.u[j], y: P.v[j] / SQ, th: rnd() * 6.3, tx: P.u[j], ty: P.v[j] / SQ, pause: rnd() * 4, stride: 0, size: WALK_SIZE * (0.9 + rnd() * 0.15), row: B_WALK, a: 1 });
    }
  }
  function steer(G, dt, look) {                               // wander, but turn up the shore-distance gradient near the edge
    const f = G.f;
    G.om = Math.max(-0.35, Math.min(0.35, G.om * (1 - dt * 0.5) + (rnd() - 0.5) * 1.2 * dt));
    const ax = G.x + Math.cos(G.th) * look, ay = G.y + Math.sin(G.th) * look;
    let turn = G.om;
    const far = f.max > NEAR + 10 && depth(f, G.x, G.y) > NEAR;          // far out: drift back toward the shore (down the gradient)
    if (far || depth(f, ax, ay) < G.margin || depth(f, G.x, G.y) < G.margin * 0.6) {
      const h = f.cell, gx = depth(f, ax + h, ay) - depth(f, ax - h, ay), gy = depth(f, ax, ay + h) - depth(f, ax, ay - h);
      let want = Math.atan2(far ? -gy : gy, far ? -gx : gx) - G.th; want = Math.atan2(Math.sin(want), Math.cos(want));
      if (gx || gy) turn = Math.sign(want) * Math.min(Math.abs(want) * (far ? 0.5 : 1.2), far ? 0.3 : 0.8);
    }
    G.th += turn * dt;
    const nx = G.x + Math.cos(G.th) * G.sp * PXM * dt, ny = G.y + Math.sin(G.th) * G.sp * PXM * dt;
    if (depth(f, nx, ny) > G.hard) {
      G.acc += Math.hypot(nx - G.x, ny - G.y); G.x = nx; G.y = ny;
      while (G.acc >= STEP) { G.acc -= STEP; G.head = (G.head + 1) % TRAIL; G.trail[2 * G.head] = G.x; G.trail[2 * G.head + 1] = G.y; }
    } else G.th += 1.5 * dt;
  }
  function stepBirds(dt) {
    for (const G of groups) {
      const f = G.f; G.ph += dt;
      const burst = 0.55 + 0.45 * Math.sin(G.ph * 0.9) * Math.sin(G.ph * 0.23 + 1);   // paddle in gentle bursts, with rests
      let spT = (burst < 0.2 ? 0.12 : 0.4 + burst * 0.8) * G.speed;
      if (G.kind === 'dive') {                                 // surface a while, dive (vanish), swim underwater, pop up elsewhere
        G.timer -= dt; const b = G.members[0];
        if (G.dive === 0 && G.timer <= 0) { G.dive = 1; G.timer = 3 + rnd() * 4; ring(G.x, G.y, b.size); }
        else if (G.dive === 1 && G.timer <= 0) { G.dive = 0; G.timer = 7 + rnd() * 12; ring(G.x, G.y, b.size); }
        if (G.dive) spT = 1.6;
        b.a = Math.max(0, Math.min(1, b.a + (G.dive ? -dt / 0.35 : dt / 0.35)));
      }
      G.sp += (spT - G.sp) * Math.min(1, dt * 0.8);
      steer(G, dt, Math.min(12, G.margin * 0.7) * PXM);
      const lead = G.members[0].size;
      for (const b of G.members) {
        if (G.kind === 'flock') {                              // drift round the shared centre
          b.p += b.w * dt; const r = b.rad * birdGrow * (0.8 + 0.2 * Math.sin(G.ph * 0.3 + b.k));
          let x = G.x + Math.cos(b.p) * r * PXM, y = G.y + Math.sin(b.p) * r * PXM;
          if (depth(f, x, y) < G.hard) { x = G.x + (x - G.x) * 0.3; y = G.y + (y - G.y) * 0.3; }
          const dx = x - b.x, dy = y - b.y;
          if (dx * dx + dy * dy > 1e-4) b.th = Math.atan2(dy + Math.sin(G.th) * G.sp * PXM * dt, dx + Math.cos(G.th) * G.sp * PXM * dt);
          b.x = x; b.y = y; continue;
        }
        if (b.k === 0) { b.x = G.x; b.y = G.y; b.th = G.th; continue; }
        // ducklings trail ~1.6 body-lengths apart (closer read as one long segmented 'fish'), adults ~1.25 lead lengths
        const gapM = (b.row === B_DUCKLING ? lead * 1.1 + (b.k - 1) * b.size * 1.6 : b.k * lead * 1.25) * birdGrow;
        const back = gapM * PXM / STEP + Math.sin(G.ph * 1.7 + b.k) * 0.6;
        const b0 = Math.min(TRAIL - 3, Math.floor(back)), fr = back - b0;
        const i0 = (G.head - b0 + TRAIL) % TRAIL, i1 = (i0 - 1 + TRAIL) % TRAIL, i2 = (i0 - 3 + TRAIL) % TRAIL;
        const x = G.trail[2 * i0] + (G.trail[2 * i1] - G.trail[2 * i0]) * fr, y = G.trail[2 * i0 + 1] + (G.trail[2 * i1 + 1] - G.trail[2 * i0 + 1]) * fr;
        const side = (b.row === B_DUCKLING ? Math.sin(G.ph * 0.9 + b.k * 2.4) * 0.45 * b.size        // ducklings wander a little side to side
          : (b.k % 2 ? 1 : -1) * 0.35 * lead) * birdGrow;                                               // adults swim a little abreast
        const wob = (Math.sin(G.ph * 2.3 + b.k * 1.9) * 0.07 * b.size + side) * PXM;
        const tx = G.trail[2 * i0] - G.trail[2 * i2], ty = G.trail[2 * i0 + 1] - G.trail[2 * i2 + 1], tl = Math.hypot(tx, ty) || 1;
        b.x = x - ty / tl * wob; b.y = y + tx / tl * wob; b.th = Math.atan2(ty, tx);
      }
    }
    for (const w of walkers) {
      if (w.pause > 0) { w.pause -= dt; continue; }
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy), st = 0.55 * PXM * dt;
      if (d <= st) {                                           // arrived: peck a while, then pick a nearby point
        w.x = w.tx; w.y = w.ty; w.pause = 1.5 + rnd() * 5;
        for (let t = 0; t < 8; t++) { const j = Math.floor(rnd() * w.P.u.length), nx = w.P.u[j], ny = w.P.v[j] / SQ;
          const dd = Math.hypot(nx - w.x, ny - w.y); if (dd > 0.8 * PXM && dd < 3.5 * PXM) { w.tx = nx; w.ty = ny; break; } }
        continue;
      }
      w.x += dx / d * st; w.y += dy / d * st; w.th = Math.atan2(dy, dx); w.stride += dt;
    }
  }
  // the bird sheet with a soft light rim baked in (once), so dark Muscovies and coots pop on the dark lake
  const halo = document.createElement('canvas'); halo.width = sheet.width; halo.height = sheet.height;
  { const h = halo.getContext('2d'); h.shadowColor = 'rgba(255, 252, 240, 0.95)'; h.shadowBlur = 3; h.drawImage(sheet, 0, 0); h.drawImage(sheet, 0, 0); }
  const traffic = carData ? makeCars({ roads: carData[0], meta: carData[1], sheet: carData[2], rnd, viewer, origin, redraw: () => draw() }) : null;
  const migrants = { flocks: [], step() {}, draw() { return 0; } };   // migrating flocks removed (looked silly over the map)

  // ---------------- drawing ----------------
  const cv = document.createElement('canvas'); cv.className = 'life-layer'; cv.setAttribute('aria-hidden', 'true');
  viewer.drawer.canvas.after(cv);
  const ctx = cv.getContext('2d');
  const DUCK = meta.bird, drawBirds = [];
  let W = 0, H = 0, dpr = 1, on = true, raf = 0, last = 0, simT = 0;
  let tz = 0, tox = 0, toy = 0;                               // transform used for the last draw
  const stats = { ms: 0, sim: 0, drawn: 0, frames: 0 };
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const r = viewer.container.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const frameOf = (gx, gy, n) => { const b = 45 - Math.atan2(-gy, gx) * DEG; return ((Math.round(b / (360 / n)) % n) + n) % n; };
  function transform() {
    const it = item(); if (!it) return false;
    tz = it.viewportToImageZoom(viewer.viewport.getZoom(true));
    const p = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)); tox = p.x; toy = p.y;
    return true;
  }
  const byY = (a, b) => a.y - b.y;
  function draw() {
    if (!transform()) return;
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    stats.drawn = 0;
    const k = tz * dpr, ox = tox * dpr - origin[0] * k, oy = toy * dpr - origin[1] * k;   // camera px -> device px
    if (!reduce.matches) stats.drawn += migrants.draw(ctx, k, ox, oy, cv.width, cv.height, dpr, simT);   // high in the sky, any zoom
    if (tz < Z_MIN) { stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1; return; }
    ctx.save(); clipToPainting(ctx, k, ox, oy);               // ground life only on the painting
    ctx.globalAlpha = Math.min(1, (tz - Z_MIN) / (Z_FULL - Z_MIN));
    ctx.imageSmoothingEnabled = k < 1.2; ctx.imageSmoothingQuality = 'high';
    const m = 60 / tz, u0 = (-tox) / tz + origin[0] - m, u1 = (W - tox) / tz + origin[0] + m, v0 = (-toy) / tz + origin[1] - m, v1 = (H - toy) / tz + origin[1] + m;
    // birds: water rings first, then sprites (back to front)
    if (birds.length || walkers.length) {
      const bg = birdGrow = Math.max(1, BIRD_MIN_PXM * dpr / (PXM * k));   // zoomed out: birds keep a readable size
      const inView = (x, g) => !(x < u0 || x > u1 || g * SQ < v0 || g * SQ > v1);
      // only a faint waterline ring round each bird: any streak behind a body this small reads as a fish tail (tried a
      // short fork, then a thin Kelvin V; both looked like fish), so there are no wakes at all.
      const rings2 = new Path2D();
      for (const b of birds) {
        if (b.a < 0.5 || !inView(b.x, b.y) || b.row === B_DUCKLING) continue;          // ducklings swim in their mother's wake
        const s = b.size * PXM * bg;
        const ex = ox + b.x * k, ey = oy + b.y * SQ * k, r = 0.36 * s * k;
        rings2.moveTo(ex + r, ey); rings2.ellipse(ex, ey, r, r * SQ * 0.9, 0, 0, 2 * Math.PI);
      }
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, 0.9 * dpr);
      ctx.strokeStyle = 'rgba(226, 240, 255, 0.3)'; ctx.stroke(rings2);
      ctx.beginPath();                                         // dive splashes
      for (let i = 0; i < RINGS; i++) {
        const o = i * 4, t = simT - rings[o + 2]; if (rings[o + 3] === 0 || t < 0 || t > 1.4 || !inView(rings[o], rings[o + 1])) continue;
        const r = (0.3 + t * 0.6) * rings[o + 3] * PXM * k, ex = ox + rings[o] * k, ey = oy + rings[o + 1] * SQ * k;
        ctx.moveTo(ex + r, ey); ctx.ellipse(ex, ey, r, r * SQ, 0, 0, 2 * Math.PI);
      }
      ctx.strokeStyle = 'rgba(230, 242, 255, 0.5)'; ctx.stroke();
      ctx.fillStyle = 'rgba(20, 30, 20, 0.28)'; ctx.beginPath();            // soft shadows under the waddlers
      for (const w of walkers) { if (!inView(w.x, w.y)) continue; const r = 0.3 * w.size * PXM * k * bg, ex = ox + w.x * k, ey = oy + w.y * SQ * k + r * 0.15;
        ctx.moveTo(ex + r, ey); ctx.ellipse(ex, ey, r, r * SQ * 0.8, 0, 0, 2 * Math.PI); }
      ctx.fill();
      drawBirds.length = 0;
      for (const b of birds) if (b.a > 0.02 && inView(b.x, b.y)) drawBirds.push(b);
      for (const w of walkers) if (inView(w.x, w.y)) drawBirds.push(w);
      drawBirds.sort(byY);
      const base = ctx.globalAlpha;
      for (const b of drawBirds) {
        const size = DUCK.VIEW * b.size * PXM * k * bg, f = frameOf(Math.cos(b.th), Math.sin(b.th), DUCK.N);
        let row = b.row, dy = 0;
        if (row === B_WALK) { row += b.pause > 0 ? 0 : Math.floor(b.stride * 5) & 1; dy = b.pause > 0 ? 0 : -Math.abs(Math.sin(b.stride * 15.7)) * 0.05 * b.size * PXM * k * bg; }
        else dy = Math.sin(simT * 3 + b.k * 1.3) * 0.03 * b.size * PXM * k * bg;          // bob on the water
        ctx.globalAlpha = base * b.a;
        ctx.drawImage(halo, f * DUCK.CELL, DUCK.y0 + row * DUCK.CELL, DUCK.CELL, DUCK.CELL, ox + b.x * k - size / 2, oy + b.y * SQ * k - size / 2 + dy, size, size);
      }
      ctx.globalAlpha = base; stats.drawn += drawBirds.length;
    }
    if (traffic && on) stats.drawn += traffic.draw(ctx, k, ox, oy, u0, u1, v0, v1, dpr);
    if (DEBUG) {                                              // ?lifedebug: where birds may swim (yellow), grass patches (cyan), roads
      if (traffic) traffic.debug(ctx, k, ox, oy, u0, u1, v0, v1);
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#ff0';
      for (const f of fields) for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) if (f.d[j * f.w + i] > 0) {
        const u = f.u0 + i * f.cell, v = (f.g0 + j * f.cell) * SQ; if (u < u0 || u > u1 || v < v0 || v > v1) continue;
        ctx.fillRect(ox + u * k - 1, oy + v * k - 1, 2, 2);
      }
      ctx.fillStyle = '#0ff';
      for (const P of water.shore || []) for (let i = 0; i < P.u.length; i++) ctx.fillRect(ox + P.u[i] * k - 1, oy + P.v[i] * k - 1, 2, 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ---------------- loop: rAF only while the page is visible and motion is allowed ----------------
  const visible = () => !document.hidden && !!item();
  function frame(t) {
    raf = 0;
    if (!visible()) { draw(); return; }
    const dt = Math.min(MAX_DT, last ? (t - last) / 1000 : 0); last = t;
    const t0 = performance.now();
    if (!reduce.matches) {
      simT += dt; stepBirds(dt); if (on) traffic?.step(dt);
      migrants.step(dt, [(W / 2 - tox) / tz + origin[0], ((H / 2 - toy) / tz + origin[1]) / SQ]);
    }
    stats.sim = stats.sim * 0.9 + (performance.now() - t0) * 0.1;
    if (tz >= Z_MIN || migrants.flocks.length || stats.drawn) draw();      // zoomed far out with an empty sky: nothing to redraw
    stats.frames++;
    if (!reduce.matches) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible() && !reduce.matches) { last = 0; raf = requestAnimationFrame(frame); } }
  // OSD draws in its own rAF: redraw after it whenever the view moved, so birds never lag a frame behind the map
  viewer.addHandler('update-viewport', () => {
    const it = item(); if (!it) return;
    const z = it.viewportToImageZoom(viewer.viewport.getZoom(true)), p = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
    if (z !== tz || p.x !== tox || p.y !== toy) draw();
    kick();
  });
  viewer.addHandler('resize', () => { resize(); draw(); });
  document.addEventListener('visibilitychange', kick);
  reduce.addEventListener?.('change', () => { draw(); kick(); });
  function setOn(v) { on = v; traffic?.setEnabled(v); button.setAttribute('aria-pressed', String(on)); draw(); kick(); }   // the button is the cars' only
  button.hidden = !traffic;
  button.addEventListener('click', () => setOn(!on));
  resize(); setOn(true);
  const ctl = { stats, birds, walkers, groups, cars: traffic?.cars || [], traffic, migrants, setOn, get on() { return on; } };
  window.__life = ctl;
  return ctl;
}
