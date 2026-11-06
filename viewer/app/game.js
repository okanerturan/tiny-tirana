// Play modes: a race on Tirana's real streets and a little plane to fly over the city.
//
// Race: a ring circuit around the centre, routed through the road graph the toy cars use (life/roads.json, camera px)
// between points on a 1.1 km circle round Skanderbeg Square, sampled every 2 m. Each sample gets a safe corner speed
// from the road's curvature; rivals drive a fraction of it, and so can you, but take a bend much faster and you spin.
// Three laps, three rivals, a countdown, turbo (limited, refills; faster in a rival's slipstream), best lap remembered.
// Fly: free flight over the map, its shadow on the ground, the landmark below named as you pass.
// One canvas over the map; the camera follows; keyboard (arrows / WASD / Space) and on-screen pedals on touch screens.
import { vehiclePx, MPP } from './vehicles.js';
import { track } from './analytics.js';

const SQ = Math.SQRT1_2, DEG = 180 / Math.PI;
const CAR_M = 4.3, LAPS = 3, VMAX = 34, VBOOST = 44, ACC = 6.5, BRAKE = 11, DRAG = 0.35, ALAT = 6.5;   // m, m/s, m/s²
const RING_M = 1100, STEP_M = 2;

export function initGame({ viewer, item, origin, t, button, toast, landmarks, nm, toCamera }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = null, data = null, raf = 0, lastT = 0, keys = new Set();
  // ---------- DOM: canvas, HUD, touch pad, menu ----------
  const cv = document.createElement('canvas'); cv.className = 'game-layer'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d'); viewer.canvas.append(cv);
  const hud = document.createElement('div'); hud.className = 'game-hud'; hud.hidden = true;
  const pad = document.createElement('div'); pad.className = 'game-pad'; pad.hidden = true;
  const menu = document.createElement('div'); menu.className = 'game-menu panel'; menu.hidden = true;
  const shell = document.querySelector('.shell'); shell.append(hud, pad, menu);
  let dpr = 1, W = 0, H = 0;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = viewer.container.clientWidth; H = viewer.container.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  const k = () => { const it = item(), a = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), b = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
    const kk = (b.x - a.x) / 1000; return { k: kk, ox: a.x - origin[0] * kk, oy: a.y - origin[1] * kk }; };

  button.addEventListener('click', () => {
    if (mode) return stop();
    menu.innerHTML = `<button type="button" data-m="race">🏁 ${t('gRace')}</button><button type="button" data-m="fly">✈️ ${t('gFly')}</button>`;
    menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', e => { const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; menu.hidden = true; start(m); });
  addEventListener('keydown', e => {
    if (!mode) return; if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') { stop(); return; }
    if (/^(Arrow|w|a|s|d|W|A|S|D| |Shift)/.test(e.key)) { keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); e.preventDefault(); }
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  const held = (...ks) => ks.some(x => keys.has(x));
  const padBtn = (label, key, cls = '') => `<button type="button" class="${cls}" data-k="${key}">${label}</button>`;
  pad.addEventListener('pointerdown', e => { const b = e.target.closest('[data-k]'); if (!b) return; e.preventDefault(); keys.add(b.dataset.k); b.setPointerCapture?.(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, e => { const b = e.target.closest('[data-k]'); if (b) keys.delete(b.dataset.k); });

  async function load() {
    if (data) return data;
    const [roads, meta, sheet] = await Promise.all([fetch('life/roads.json').then(r => r.json()), fetch('life/cars.json').then(r => r.json()),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'life/cars.webp'; })]);
    return (data = { roads, CAR: meta.car, sheet });
  }

  // ---------- circuit ----------
  function buildCircuit(roads) {
    const V = roads.verts, nV = V.length / 2, adj = Array.from({ length: nV }, () => []);
    const gm = (du, dv) => Math.hypot(du * MPP, dv * MPP / SQ);                     // camera px -> ground metres
    roads.edges.forEach(([a, b, cls, flags, , dl]) => {
      if (flags & 2) return;                                                         // tunnels / covered
      const pts = [[V[2 * a], V[2 * a + 1]]]; let x = V[2 * a], y = V[2 * a + 1];
      for (let i = 0; i < dl.length; i += 2) { x += dl[i]; y += dl[i + 1]; pts.push([x, y]); }
      pts.push([V[2 * b], V[2 * b + 1]]);
      let len = 0; for (let i = 1; i < pts.length; i++) len += gm(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const cost = len * [1, 1.15, 1.4, 2.2, 3.5][cls] ;
      adj[a].push({ to: b, pts, cost }); adj[b].push({ to: a, pts: pts.slice().reverse(), cost });
    });
    const [cu, cv0] = toCamera(41.3275, 19.8187);
    const near = (u, v) => { let best = -1, bd = Infinity;
      for (let i = 0; i < nV; i++) { if (!adj[i].some(e => e.cost / 1 < 1e9) || !adj[i].length) continue;
        const d = (V[2 * i] - u) ** 2 + ((V[2 * i + 1] - v) / SQ) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
    const wps = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * Math.PI; wps.push(near(cu + Math.cos(a) * RING_M / MPP, cv0 + Math.sin(a) * RING_M / MPP * SQ)); }
    const path = (s, g) => {                                                         // Dijkstra on cost
      const dist = new Map([[s, 0]]), prev = new Map(), open = [[0, s]];
      while (open.length) { open.sort((x, y) => x[0] - y[0]); const [d, n] = open.shift(); if (n === g) break; if (d > dist.get(n)) continue;
        for (const e of adj[n]) { const nd = d + e.cost; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, [n, e]); open.push([nd, e.to]); } } }
      const out = []; let n = g; while (n !== s && prev.has(n)) { const [p, e] = prev.get(n); out.unshift(e); n = p; } return out; };
    let pts = [];
    for (let i = 0; i < wps.length; i++) for (const e of path(wps[i], wps[(i + 1) % wps.length])) pts.push(...(pts.length ? e.pts.slice(1) : e.pts));
    // drop out-and-back spurs (a point that comes back to where it was two steps ago)
    for (let changed = true; changed;) { changed = false;
      for (let i = 2; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[i - 2][0], pts[i][1] - pts[i - 2][1]) < 1) { pts.splice(i - 1, 2); changed = true; break; } }
    // resample every STEP_M metres
    const U = [], Vv = [], S = []; let acc = 0, s = 0;
    U.push(pts[0][0]); Vv.push(pts[0][1]); S.push(0);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = gm(x1 - x0, y1 - y0); let tt = 0;
      while (acc + d * (1 - tt) >= STEP_M) { tt += (STEP_M - acc) / d; acc = 0; s += STEP_M; U.push(x0 + (x1 - x0) * tt); Vv.push(y0 + (y1 - y0) * tt); S.push(s); }
      acc += d * (1 - tt);
    }
    const n = U.length, L = n * STEP_M, head = new Float32Array(n), vsafe = new Float32Array(n), vlim = new Float32Array(n);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; head[i] = Math.atan2((Vv[j] - Vv[i]) / SQ, U[j] - U[i]); }
    for (let i = 0; i < n; i++) {                                                    // curvature over +-8 m
      const a = head[(i - 4 + n) % n], b = head[(i + 4) % n]; let dth = Math.abs(b - a); if (dth > Math.PI) dth = 2 * Math.PI - dth;
      const kap = dth / 16; vsafe[i] = Math.min(VMAX, kap > 1e-4 ? Math.sqrt(ALAT / kap) : VMAX);
    }
    for (let i = 0; i < n; i++) vlim[i] = vsafe[i];
    for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) { const j = (i + 1) % n; vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[j] ** 2 + 2 * BRAKE * 0.8 * STEP_M)); }
    return { U, V: Vv, n, L, head, vsafe, vlim, path: (() => { const p = new Path2D(); for (let i = 0; i <= n; i++) { const q = i % n; i ? p.lineTo(U[q], Vv[q]) : p.moveTo(U[q], Vv[q]); } return p; })() };
  }
  const idx = (C, s) => Math.floor(((s % C.L) + C.L) % C.L / STEP_M) % C.n;
  const posOn = (C, s) => { const f = (((s % C.L) + C.L) % C.L) / STEP_M, i = Math.floor(f) % C.n, j = (i + 1) % C.n, a = f - Math.floor(f);
    return [C.U[i] + (C.U[j] - C.U[i]) * a, C.V[i] + (C.V[j] - C.V[i]) * a, C.head[i]]; };

  // ---------- race state ----------
  let R = null;
  function newRace(C) {
    const skill = [0.9, 0.86, 0.82];
    return { C, t: -3.2, cars: [{ me: true, s: -24, v: 0, row: 0, lap: [], spin: 0, boost: 1, best: null, done: null },
      ...skill.map((sk, i) => ({ s: -6 - i * 6, v: 0, row: [1, 3, 4][i], sk, jitter: Math.random() * 6, lap: [], done: null }))], calls: [], lastLapAt: 0, finished: false, goPressed: null };
  }
  const call = (txt) => { R.calls.push({ txt, t: performance.now() }); };
  function stepRace(dt) {
    const C = R.C, me = R.cars[0]; R.t += dt;
    if (R.t < 0) { if (held('ArrowUp', 'w') && R.goPressed === null && R.t > -0.25) R.goPressed = R.t; return; }
    if (R.goPressed !== null && R.goPressed > -0.25 && !R.perfectGiven) { R.perfectGiven = true; me.v = 12; call(t('gPerfect')); }
    for (const c of R.cars) {
      if (c.done) { c.v = Math.max(0, c.v - BRAKE * dt); c.s += c.v * dt; continue; }
      const i = idx(C, c.s);
      if (c.me) {
        const gas = held('ArrowUp', 'w'), brk = held('ArrowDown', 's'), wantBoost = held(' ', 'Shift') && c.boost > 0.02;
        const near = R.cars.some(o => !o.me && o.s - c.s > 2 && o.s - c.s < 14);
        if (near && !c.wasDraft) call(t('gDraft')); c.wasDraft = near;
        c.boost = Math.min(1, c.boost + dt * (near ? 0.16 : 0.06) - (wantBoost ? dt * 0.28 : 0));
        const vtop = wantBoost ? VBOOST : VMAX;
        if (c.spin > 0) { c.spin -= dt; c.v = Math.max(0, c.v - BRAKE * 1.4 * dt); }
        else c.v += (gas ? ACC * (1 - c.v / vtop) + (near ? 0.8 : 0) : -DRAG * c.v) * dt - (brk ? BRAKE * dt : 0);
        c.v = Math.max(0, c.v);
        if (c.spin <= 0 && c.v > C.vsafe[i] * 1.18 + 1.5) { c.spin = 1.1; c.v *= 0.35; call(t('gSpin')); }
      } else {
        const target = C.vlim[i] * c.sk + Math.sin(R.t * 0.7 + c.jitter) * 0.6;
        c.v += Math.max(-BRAKE, Math.min(ACC * 0.85, (target - c.v) * 2)) * dt; c.v = Math.max(0, c.v);
      }
      const before = c.s; c.s += c.v * dt;
      if (Math.floor(c.s / C.L) > Math.floor(before / C.L) && c.s > 0) {            // crossed the line
        const lapT = R.t - (c.lapStart ?? 0); c.lapStart = R.t;
        if (c.s > C.L * 0.5) c.lap.push(lapT);
        if (c.me) {
          const n = c.lap.length; if (n && (!c.best || lapT < c.best)) { c.best = lapT; if (n > 0) call(t('gBestLap')); }
          if (n === LAPS - 1) call(t('gLastLap'));
          try { const rec = Number(localStorage.getItem('tt-race-best') || Infinity); if (n && lapT < rec) localStorage.setItem('tt-race-best', String(lapT)); } catch {}
        }
        if (c.lap.length >= LAPS) c.done = R.t;
      }
    }
    if (me.done && !R.finished) { R.finished = true; track('game', { mode: 'race', place: place(), time: Math.round(me.done) }); setTimeout(showResult, 900); }
  }
  const place = () => 1 + R.cars.filter(c => !c.me && c.s > R.cars[0].s).length;
  const fmtT = x => x == null ? '–' : `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
  function raceHud() {
    const me = R.cars[0], lap = Math.min(LAPS, me.lap.length + 1);
    let best = null; try { best = Number(localStorage.getItem('tt-race-best')) || null; } catch {}
    hud.innerHTML = `<div class="g-top"><span>${t('gLap')} <b>${lap}/${LAPS}</b></span><span>${t('gPos')} <b>${place()}/4</b></span><span><b>${fmtT(Math.max(0, R.t))}</b></span>`
      + `<span class="g-best">${t('gBest')} ${fmtT(best)}</span><button type="button" class="g-exit" aria-label="${t('close')}">✕</button></div>`
      + `<div class="g-speed"><b>${Math.round(me.v * 3.6)}</b> km/h<i style="--b:${(me.boost * 100).toFixed(0)}%"></i></div>`
      + (R.t < 0 ? `<div class="g-count">${Math.ceil(-R.t) || t('gGo')}</div>` : R.t < 0.8 ? `<div class="g-count">${t('gGo')}</div>` : '')
      + R.calls.filter(c => performance.now() - c.t < 1400).slice(-1).map(c => `<div class="g-call">${c.txt}</div>`).join('');
    hud.querySelector('.g-exit').onclick = stop;
  }
  function showResult() {
    const rows = [...R.cars].sort((a, b) => (a.done ?? 1e9) - (b.done ?? 1e9) || b.s - a.s);
    hud.innerHTML = `<div class="g-result panel"><h2>${t('gFinished')}: ${place()}/4</h2><ol>${rows.map(c => `<li class="${c.me ? 'me' : ''}">${c.me ? t('gYou') : t('gRival')} <span>${fmtT(c.done)}</span></li>`).join('')}</ol>`
      + `<p>${t('gBestLap')}: <b>${fmtT(R.cars[0].best)}</b></p><div class="g-actions"><button type="button" class="btn" data-a="exit">${t('close')}</button><button type="button" class="btn primary" data-a="again">${t('gAgain')}</button></div></div>`;
    hud.querySelector('[data-a=exit]').onclick = stop; hud.querySelector('[data-a=again]').onclick = () => { R = newRace(R.C); };
    R.showing = true;
  }

  // ---------- fly state ----------
  let F = null;
  function newFlight() { const [u, v] = toCamera(41.3275, 19.8187); return { u, v, th: -Math.PI / 4, sp: 55, alt: 140, trail: [], over: null }; }
  function stepFly(dt) {
    const turn = (held('ArrowLeft', 'a') ? -1 : 0) + (held('ArrowRight', 'd') ? 1 : 0);
    if (held('ArrowUp', 'w')) F.sp = Math.min(95, F.sp + 25 * dt); if (held('ArrowDown', 's')) F.sp = Math.max(30, F.sp - 25 * dt);
    F.th += turn * 0.9 * dt; F.bank = (F.bank || 0) * 0.9 + turn * 0.1;
    F.u += Math.cos(F.th) * F.sp * dt / MPP; F.v += Math.sin(F.th) * F.sp * dt / MPP * SQ;
    const it = item(), sz = it.getContentSize(), x = F.u - origin[0], y = F.v - origin[1];   // stay over the canvas: turn back at its edges
    if (x < 2000 || y < 2000 || x > sz.x - 2000 || y > sz.y - 2000) { const [cu, cv0] = [origin[0] + sz.x / 2, origin[1] + sz.y / 2]; const want = Math.atan2((cv0 - F.v) / SQ, cu - F.u);
      let d = want - F.th; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; F.th += Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt); }
    F.trail.push([F.u, F.v]); if (F.trail.length > 60) F.trail.shift();
    let best = null, bd = 260 * 260;                                                  // the landmark below (within 260 m)
    for (const p of landmarks()) { const [pu, pv] = toCamera(p.lat, p.lon); const d = ((pu - F.u) * MPP) ** 2 + ((pv - F.v) * MPP / SQ) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best !== F.over) { F.over = best; if (best) track('game', { mode: 'fly', over: best.id }); }
  }
  function flyHud() {
    hud.innerHTML = `<div class="g-top"><span>✈️ <b>${Math.round(F.sp * 3.6)}</b> km/h</span><span>${t('gAlt')} <b>${F.alt} m</b></span>`
      + `<button type="button" class="g-exit" aria-label="${t('close')}">✕</button></div>` + (F.over ? `<div class="g-call g-over">${t('gOver')} ${nm(F.over)}</div>` : '');
    hud.querySelector('.g-exit').onclick = stop;
  }

  // ---------- draw ----------
  function draw() {
    if (!item()) return;
    if (cv.width !== Math.round(viewer.container.clientWidth * Math.min(2, devicePixelRatio || 1))) resize();
    const { k: kk, ox, oy } = k(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'race' && R) {
      const C = R.C, { CAR, sheet } = data;
      ctx.save(); ctx.setTransform(dpr * kk, 0, 0, dpr * kk, dpr * ox, dpr * oy);
      ctx.lineWidth = 7 / kk; ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.setLineDash([14 / kk, 12 / kk]); ctx.stroke(C.path); ctx.restore();
      const [su, sv, sh] = posOn(C, 0);                                              // start/finish line
      ctx.save(); ctx.translate(ox + su * kk, oy + sv * kk); ctx.rotate(Math.atan2(Math.sin(sh) * SQ, Math.cos(sh)) + Math.PI / 2);
      const w = Math.max(14, 12 * kk / MPP); for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#111' : '#fff'; ctx.fillRect(-w / 2 + i * w / 6, -3, w / 6, 6); } ctx.restore();
      const size = vehiclePx(CAR_M, kk * dpr) * (CAR.VIEW / CAR_M) * 1.25 / dpr;   // a bit larger than traffic: these are the racers
      const list = R.cars.map(c => { const [u, v, h] = posOn(C, c.s); return { c, u, v, h }; }).sort((a, b) => a.v - b.v);
      for (const { c, u, v, h } of list) {
        const gx = Math.cos(h + (c.spin > 0 ? c.spin * 9 : 0)), gy = Math.sin(h + (c.spin > 0 ? c.spin * 9 : 0));
        const f = ((Math.round((45 - Math.atan2(-gy, gx) * DEG) / (360 / CAR.N)) % CAR.N) + CAR.N) % CAR.N;
        const x = ox + u * kk, y = oy + v * kk;
        ctx.drawImage(sheet, f * CAR.CELL, CAR.y0 + c.row * CAR.CELL, CAR.CELL, CAR.CELL, x - size / 2, y - size / 2, size, size);
        if (c.me) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y - size * 0.55); ctx.lineTo(x - 5, y - size * 0.55 - 8); ctx.lineTo(x + 5, y - size * 0.55 - 8); ctx.fill(); }
      }
    }
    if (mode === 'fly' && F) {
      const m = kk / MPP, span = Math.max(26, 30 * m), lift = F.alt * SQ / MPP * kk * 0.35;   // drawn height compressed, like the live planes
      const draw1 = (x, y, fill) => { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(Math.sin(F.th) * SQ, Math.cos(F.th)) + Math.PI / 2); ctx.scale(1 + (F.bank || 0) * 0.0, 1);
        const s = span / 2; ctx.fillStyle = fill; ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.12, -s * 0.55); ctx.lineTo(s, s * 0.05); ctx.lineTo(s, s * 0.2); ctx.lineTo(s * 0.12, s * 0.05); ctx.lineTo(s * 0.1, s * 0.7);
        ctx.lineTo(s * 0.38, s * 0.92); ctx.lineTo(s * 0.38, s); ctx.lineTo(0, s * 0.9); ctx.lineTo(-s * 0.38, s); ctx.lineTo(-s * 0.38, s * 0.92); ctx.lineTo(-s * 0.1, s * 0.7);
        ctx.lineTo(-s * 0.12, s * 0.05); ctx.lineTo(-s, s * 0.2); ctx.lineTo(-s, s * 0.05); ctx.lineTo(-s * 0.12, -s * 0.55); ctx.closePath(); ctx.fill(); ctx.restore(); };
      const gx = ox + F.u * kk, gy = oy + F.v * kk;
      draw1(gx, gy, 'rgba(10, 20, 30, 0.28)');                                       // shadow on the ground
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
      F.trail.forEach(([u, v], i) => { const x = ox + u * kk, y = oy + v * kk - lift; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      draw1(gx, gy - lift, '#f4f6f8'); ctx.strokeStyle = 'rgba(30,40,60,0.6)'; ctx.lineWidth = 1;
    }
  }
  function follow(u, v, zoom) {
    const it = item(), vp = viewer.viewport, p = it.imageToViewportCoordinates(u - origin[0], v - origin[1]);
    vp.panTo(p, true); if (zoom) vp.zoomTo(it.imageToViewportZoom(zoom), null, true);
  }
  function loop(ts) {
    raf = 0; if (!mode) return;
    const dt = Math.min(0.05, lastT ? (ts - lastT) / 1000 : 0); lastT = ts;
    if (mode === 'race') { if (!R.showing) { stepRace(dt); raceHud(); } const [u, v, h] = posOn(R.C, R.cars[0].s); follow(u + Math.cos(h) * 25 / MPP, v + Math.sin(h) * 25 / MPP * SQ); }
    else { stepFly(dt); flyHud(); follow(F.u + Math.cos(F.th) * 120 / MPP, F.v + Math.sin(F.th) * 120 / MPP * SQ); }
    draw(); raf = requestAnimationFrame(loop);
  }
  async function start(m) {
    if (reduced.matches && m === 'fly') {}                                           // still allowed: the user started it
    try { await load(); } catch (e) { console.warn('[game]', e); return; }
    mode = m; keys.clear(); lastT = 0; document.body.classList.add('playing'); button.setAttribute('aria-pressed', 'true');
    viewer.setMouseNavEnabled(false); hud.hidden = false; pad.hidden = false; resize();
    if (m === 'race') {
      data.C ??= buildCircuit(data.roads); R = newRace(data.C);
      pad.innerHTML = padBtn('◀ ' + t('gBrake'), 'ArrowDown', 'brake') + padBtn('⚡', ' ', 'boost') + padBtn(t('gGas') + ' ▶', 'ArrowUp', 'gas');
      const it = item(); viewer.viewport.zoomTo(it.imageToViewportZoom(0.72), null, false);
    } else {
      F = newFlight(); pad.innerHTML = padBtn('↺', 'ArrowLeft') + padBtn('−', 'ArrowDown') + padBtn('+', 'ArrowUp') + padBtn('↻', 'ArrowRight');
      const it = item(); viewer.viewport.zoomTo(it.imageToViewportZoom(0.22), null, false);
    }
    track('game', { mode: m, start: true });
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    mode = null; R = null; F = null; cancelAnimationFrame(raf); raf = 0; keys.clear();
    hud.hidden = true; pad.hidden = true; menu.hidden = true; hud.innerHTML = ''; document.body.classList.remove('playing');
    button.setAttribute('aria-pressed', 'false'); viewer.setMouseNavEnabled(true);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  }
  addEventListener('resize', () => { if (mode) resize(); });
  return { start, stop, get mode() { return mode; } };
}
