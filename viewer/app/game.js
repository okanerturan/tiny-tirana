// Play modes: race a car round Tirana's centre on the real streets, or fly a little plane over the city.
//
// Race: you steer (arrows / WASD, Space = turbo). The track is a ring of real roads round Skanderbeg Square (life/roads.json,
// routed through 8 points on a 1.1 km circle, sampled every 2 m). The road is ~14 m wide: off it the grass slows you,
// further out a soft barrier pushes you back. Three rivals drive the racing line at their own pace (they brake for
// bends: each sample has a safe speed from the road's curvature); touch one and both get a knock. Three laps, a countdown,
// a slipstream behind a rival that refills turbo, your best lap remembered. While playing, traffic, buses, landmarks and
// the other chrome are hidden; sound is WebAudio (engine note follows speed; mute in the HUD, remembered).
// Fly: steer a little plane over the map with its shadow on the ground; the landmark below is named as you pass.
import { vehiclePx, MPP } from './vehicles.js';
import { track } from './analytics.js';

const SQ = Math.SQRT1_2, DEG = 180 / Math.PI;
const CAR_M = 4.3, LAPS = 3, VMAX = 36, VBOOST = 46, ACC = 7, BRAKE = 12, ALAT = 7, HALF = 7, WALL = 13, GRASS_V = 11;
const RING_M = 1100, STEP_M = 2;

// ---------- sound (WebAudio, made on the fly: no files) ----------
function makeSound() {
  let ac = null, eng = null, engGain = null, filt = null, muted = false;
  try { muted = localStorage.getItem('tt-mute') === '1'; } catch {}
  const ctx = () => { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); } if (ac.state === 'suspended') ac.resume(); return ac; };
  const out = () => { const c = ctx(); if (!c) return null; const g = c.createGain(); g.gain.value = muted ? 0 : 1; g.connect(c.destination); return g; };
  function beep(f, dur = 0.15, type = 'square', vol = 0.12) { const c = ctx(); if (!c || muted) return; const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.02); }
  function noise(dur = 0.25, vol = 0.15, lp = 800) { const c = ctx(); if (!c || muted) return; const n = c.sampleRate * dur, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = vol; s.connect(f).connect(g).connect(c.destination); s.start(); }
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('tt-mute', muted ? '1' : '0'); } catch {} if (engGain) engGain.gain.value = 0; return muted; },
    engine(on, kind = 'car') { const c = ctx(); if (!c) return;
      if (on && !eng) { eng = c.createOscillator(); eng.type = kind === 'car' ? 'sawtooth' : 'triangle'; filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
        engGain = c.createGain(); engGain.gain.value = 0; eng.connect(filt).connect(engGain).connect(c.destination); eng.start(); }
      if (!on && eng) { try { eng.stop(); } catch {} eng = null; engGain = null; } },
    rev(x, kind = 'car') { if (!eng || !ac) return; const t = ac.currentTime;          // x: 0..1 of top speed
      eng.frequency.setTargetAtTime(kind === 'car' ? 48 + x * 150 + (x * 7 % 1) * 12 : 90 + x * 60, t, 0.05);
      filt.frequency.setTargetAtTime(kind === 'car' ? 350 + x * 1400 : 600, t, 0.08); engGain.gain.setTargetAtTime(muted ? 0 : (kind === 'car' ? 0.045 + x * 0.05 : 0.035), t, 0.08); },
    beep, noise,
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'triangle', 0.13), i * 140)); },
  };
}

export function initGame({ viewer, item, origin, t, button, landmarks, nm, toCamera }) {
  let mode = null, data = null, raf = 0, lastT = 0; const keys = new Set(), snd = makeSound();
  const cv = document.createElement('canvas'); cv.className = 'game-layer'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d'); viewer.canvas.append(cv);
  const hud = document.createElement('div'); hud.className = 'game-hud'; hud.hidden = true;
  const pad = document.createElement('div'); pad.className = 'game-pad'; pad.hidden = true;
  const menu = document.createElement('div'); menu.className = 'game-menu panel'; menu.hidden = true;
  document.querySelector('.shell').append(hud, pad, menu);
  let dpr = 1, W = 0, H = 0;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = viewer.container.clientWidth; H = viewer.container.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  const view = () => { const it = item(), a = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), b = it.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
    const k = (b.x - a.x) / 1000; return { k, ox: a.x - origin[0] * k, oy: a.y - origin[1] * k }; };
  const gm = (du, dv) => Math.hypot(du * MPP, dv * MPP / SQ);                           // camera px -> ground metres
  const step = (u, v, th, m) => [u + Math.cos(th) * m / MPP, v + Math.sin(th) * m / MPP * SQ];
  const scrAng = th => Math.atan2(Math.sin(th) * SQ, Math.cos(th));                       // ground heading -> screen angle

  const RACE = new URLSearchParams(location.search).get('race') === '1';             // the race is gated (not public yet)
  button.addEventListener('click', () => {
    if (mode) return stop();
    if (!RACE) return start('fly');
    menu.innerHTML = `<button type="button" data-m="race">🏁 ${t('gRace')}<small>${t('gRaceHint')}</small></button><button type="button" data-m="fly">✈️ ${t('gFly')}<small>${t('gFlyHint')}</small></button>`;
    menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', e => { const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; menu.hidden = true; start(m); });
  // keys: captured BEFORE the map's own keyboard navigation (which pans on WASD / arrows) while a mode runs
  const keyName = e => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const GAME_KEYS = /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|w|a|s|d| |Shift|m)$/;
  addEventListener('keydown', e => {
    if (!mode || e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') { stop(); e.stopPropagation(); return; }
    const k = keyName(e); if (!GAME_KEYS.test(k)) return;
    if (k === 'm' && !e.repeat) toggleMute();
    keys.add(k); e.preventDefault(); e.stopPropagation();
  }, true);
  addEventListener('keyup', e => { if (!mode) return; keys.delete(keyName(e)); e.stopPropagation(); }, true);
  addEventListener('blur', () => keys.clear());
  const held = (...ks) => ks.some(x => keys.has(x));
  const padBtn = (label, key, cls = '') => `<button type="button" class="${cls}" data-k="${key}" aria-label="${label}">${label}</button>`;
  pad.addEventListener('pointerdown', e => { const b = e.target.closest('[data-k]'); if (!b) return; e.preventDefault(); keys.add(b.dataset.k); b.setPointerCapture?.(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, e => { const b = e.target.closest('[data-k]'); if (b) keys.delete(b.dataset.k); });
  const toggleMute = () => { snd.toggle(); if (!snd.muted) snd.beep(660, 0.08); };

  async function load() {
    if (data) return data;
    const [roads, meta, sheet] = await Promise.all([fetch('life/roads.json').then(r => r.json()), fetch('life/cars.json').then(r => r.json()),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'life/cars.webp'; })]);
    const plane = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'planes/sheet.webp'; });
    let shadow = null;
    if (plane) { shadow = document.createElement('canvas'); shadow.width = plane.width; shadow.height = plane.height; const g = shadow.getContext('2d');
      g.drawImage(plane, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgb(12, 20, 30)'; g.fillRect(0, 0, shadow.width, shadow.height); }
    return (data = { roads, CAR: meta.car, sheet, plane, shadow, PL: { N: 32, CELL: 192, VIEW: 50 } });
  }

  // ---------- circuit (the racing line) ----------
  function buildCircuit(roads) {
    const V = roads.verts, nV = V.length / 2, adj = Array.from({ length: nV }, () => []);
    roads.edges.forEach(([a, b, cls, flags, , dl]) => {
      if (flags & 2) return;
      const pts = [[V[2 * a], V[2 * a + 1]]]; let x = V[2 * a], y = V[2 * a + 1];
      for (let i = 0; i < dl.length; i += 2) { x += dl[i]; y += dl[i + 1]; pts.push([x, y]); }
      pts.push([V[2 * b], V[2 * b + 1]]);
      let len = 0; for (let i = 1; i < pts.length; i++) len += gm(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const cost = len * [1, 1.15, 1.4, 2.2, 3.5][cls];
      adj[a].push({ to: b, pts, cost }); adj[b].push({ to: a, pts: pts.slice().reverse(), cost });
    });
    const [cu, cv0] = toCamera(41.3275, 19.8187);
    const near = (u, v) => { let best = -1, bd = Infinity;
      for (let i = 0; i < nV; i++) { if (!adj[i].length) continue; const d = (V[2 * i] - u) ** 2 + ((V[2 * i + 1] - v) / SQ) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
    const wps = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * Math.PI; wps.push(near(cu + Math.cos(a) * RING_M / MPP, cv0 + Math.sin(a) * RING_M / MPP * SQ)); }
    const path = (s, g) => {
      const dist = new Map([[s, 0]]), prev = new Map(), open = [[0, s]];
      while (open.length) { open.sort((x, y) => x[0] - y[0]); const [d, n] = open.shift(); if (n === g) break; if (d > dist.get(n)) continue;
        for (const e of adj[n]) { const nd = d + e.cost; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, [n, e]); open.push([nd, e.to]); } } }
      const out = []; let n = g; while (n !== s && prev.has(n)) { const [p, e] = prev.get(n); out.unshift(e); n = p; } return out; };
    let pts = [];
    for (let i = 0; i < wps.length; i++) for (const e of path(wps[i], wps[(i + 1) % wps.length])) pts.push(...(pts.length ? e.pts.slice(1) : e.pts));
    for (let changed = true; changed;) { changed = false;
      for (let i = 2; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[i - 2][0], pts[i][1] - pts[i - 2][1]) < 1) { pts.splice(i - 1, 2); changed = true; break; } }
    const U = [], Vv = []; let acc = 0;
    U.push(pts[0][0]); Vv.push(pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = gm(x1 - x0, y1 - y0); let tt = 0;
      while (d > 0 && acc + d * (1 - tt) >= STEP_M) { tt += (STEP_M - acc) / d; acc = 0; U.push(x0 + (x1 - x0) * tt); Vv.push(y0 + (y1 - y0) * tt); }
      acc += d * (1 - tt);
    }
    const n = U.length, L = n * STEP_M, head = new Float32Array(n), vsafe = new Float32Array(n), vlim = new Float32Array(n);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; head[i] = Math.atan2((Vv[j] - Vv[i]) / SQ, U[j] - U[i]); }
    for (let i = 0; i < n; i++) { const a = head[(i - 4 + n) % n], b = head[(i + 4) % n]; let dth = Math.abs(b - a); if (dth > Math.PI) dth = 2 * Math.PI - dth;
      const kap = dth / 16; vsafe[i] = Math.min(VMAX, kap > 1e-4 ? Math.sqrt(ALAT / kap) : VMAX); }
    for (let i = 0; i < n; i++) vlim[i] = vsafe[i];
    for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) { const j = (i + 1) % n; vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[j] ** 2 + 2 * BRAKE * 0.8 * STEP_M)); }
    const line = new Path2D(); for (let i = 0; i <= n; i++) { const q = i % n; i ? line.lineTo(U[q], Vv[q]) : line.moveTo(U[q], Vv[q]); }
    return { U, V: Vv, n, L, head, vlim, line };
  }
  // nearest sample to (u, v), searching around a hint index; returns [index, signed lateral metres]
  function locate(C, u, v, hint) {
    let best = hint, bd = Infinity;
    for (let d = -30; d <= 30; d++) { const i = (hint + d + C.n) % C.n, e = gm(C.U[i] - u, C.V[i] - v); if (e < bd) { bd = e; best = i; } }
    const h = C.head[best], du = (u - C.U[best]) * MPP, dv = (v - C.V[best]) * MPP / SQ, lat = -Math.sin(h) * du + Math.cos(h) * dv;
    return [best, lat];
  }
  const onLine = (C, s, off = 0) => { const f = (((s % C.L) + C.L) % C.L) / STEP_M, i = Math.floor(f) % C.n, j = (i + 1) % C.n, a = f - Math.floor(f), h = C.head[i];
    const u = C.U[i] + (C.U[j] - C.U[i]) * a, v = C.V[i] + (C.V[j] - C.V[i]) * a; return [u - Math.sin(h) * off / MPP, v + Math.cos(h) * off / MPP * SQ, h]; };

  // ---------- race ----------
  let R = null;
  function newRace(C) {
    const [u, v, h] = onLine(C, C.L - 20, -2.5);                                        // you start at the back, left
    const rivals = [0.93, 0.89, 0.85].map((sk, i) => ({ s: C.L - 14 + i * 6, off: [2.5, -2.5, 2.5][i], sp: 0, row: [1, 3, 4][i], sk, jit: Math.random() * 6, lap: 0, done: null, u: 0, y: 0, h: 0 }));
    rivals.forEach(r => { r.s -= C.L; [r.u, r.y, r.h] = onLine(C, r.s, r.off); });                                               // just behind the line: lap 0 begins when they cross it
    return { C, t: -3.5, beat: 4, me: { u, v, th: h, sp: 0, idx: (C.n - 10 + C.n) % C.n, prog: -20, lap: 0, lapStart: 0, best: null, boost: 1, done: null, grass: false },
      rivals, calls: [], over: false };
  }
  const call = txt => R.calls.push({ txt, t: performance.now() });
  function stepRace(dt) {
    const C = R.C, me = R.me; R.t += dt;
    if (R.t < 0) { const b = Math.ceil(-R.t); if (b < R.beat) { R.beat = b; snd.beep(440, 0.14); } return; }
    if (R.beat > 0) { R.beat = 0; snd.beep(880, 0.35); call(t('gGo')); }
    // you
    if (!me.done) {
      const gas = held('ArrowUp', 'w'), brk = held('ArrowDown', 's'), steer = (held('ArrowLeft', 'a') ? -1 : 0) + (held('ArrowRight', 'd') ? 1 : 0);
      const near = R.rivals.find(o => { const d = gm(o.u - me.u, o.y - me.v); return d > 3 && d < 16 && Math.cos(Math.atan2((o.y - me.v) / SQ, o.u - me.u) - me.th) > 0.85; });
      if (near && !me.draft) call(t('gDraft')); me.draft = !!near;
      const wantBoost = held(' ', 'Shift') && me.boost > 0.02;
      if (wantBoost && !me.boosting) snd.noise(0.5, 0.12, 2400); me.boosting = wantBoost;
      me.boost = Math.min(1, me.boost + dt * (near ? 0.18 : 0.05) - (wantBoost ? dt * 0.3 : 0));
      const top = (wantBoost ? VBOOST : VMAX) * (me.grass ? GRASS_V / VMAX : 1);
      if (gas) me.sp += (ACC * Math.max(0, 1 - me.sp / top) + (near ? 0.9 : 0)) * dt;
      else if (brk) me.sp -= (me.sp > 0.5 ? BRAKE : 3) * dt;                             // brake, then a slow reverse
      else me.sp -= 0.6 * me.sp * dt;
      if (me.sp > top) me.sp -= (me.grass ? 18 : 4) * dt;
      me.sp = Math.max(-4, me.sp);
      me.th += steer * Math.max(0.45, Math.min(1, Math.abs(me.sp) / 7)) * (2.3 - Math.min(1, Math.abs(me.sp) / VBOOST) * 1.1) * dt * Math.sign(me.sp || 1);
      if (!steer && me.sp > 2) {                                                          // assist: ease onto the racing line 12 m ahead
        const [tu, tv] = onLine(C, (me.idx * STEP_M) + 12), want = Math.atan2((tv - me.v) / SQ, tu - me.u);
        let d = want - me.th; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; me.th += Math.sign(d) * Math.min(Math.abs(d), 1.1 * dt); }
      [me.u, me.v] = step(me.u, me.v, me.th, me.sp * dt);
      let lat; [me.idx, lat] = locate(C, me.u, me.v, me.idx);
      const grass = Math.abs(lat) > HALF; if (grass && !me.grass && me.sp > 8) { snd.noise(0.4, 0.14, 500); call(t('gGrass')); } me.grass = grass;
      if (Math.abs(lat) > WALL) {                                                         // soft barrier: back onto the road side, speed scrubbed
        const h = C.head[me.idx], back = Math.abs(lat) - WALL, sgn = Math.sign(lat);
        me.u += Math.sin(h) * sgn * back / MPP; me.v -= Math.cos(h) * sgn * back / MPP * SQ;
        if (!me.walled) { snd.noise(0.25, 0.2, 300); me.sp *= 0.7; } me.walled = true;     // one knock per touch, not a brake every frame
      } else me.walled = false;
      // progress along the line, laps
      const raw = me.idx * STEP_M; let dl = raw - (me.raw ?? raw); if (dl < -C.L / 2) dl += C.L; else if (dl > C.L / 2) dl -= C.L;
      const prevProg = me.prog; me.raw = raw; me.prog += dl; const p = me.prog;
      if (Math.floor(p / C.L) > Math.floor(prevProg / C.L)) {                             // crossed the line forwards: lap counter = lap you are on
        me.lap++; const lapT = R.t - me.lapStart; me.lapStart = R.t;
        if (me.lap > 1) {                                                                 // the first crossing just starts lap 1
          if (!me.best || lapT < me.best) { me.best = lapT; if (me.lap > 1) call(t('gBestLap')); }
          try { const rec = Number(localStorage.getItem('tt-race-best') || Infinity); if (lapT < rec && me.lap > 1) localStorage.setItem('tt-race-best', String(lapT)); } catch {}
        }
        if (me.lap === LAPS) { call(t('gLastLap')); snd.beep(990, 0.12); }
        if (me.lap > LAPS) { me.done = R.t; snd.fanfare(); }
      }
      snd.rev(Math.min(1, Math.abs(me.sp) / VBOOST));
    }
    // rivals: on the racing line, braking for bends, a little wobble each
    for (const r of R.rivals) {
      const i = Math.floor((((r.s % C.L) + C.L) % C.L) / STEP_M) % C.n, target = r.done ? 0 : C.vlim[i] * r.sk + Math.sin(R.t * 0.6 + r.jit) * 0.7;
      r.sp += Math.max(-BRAKE, Math.min(ACC * 0.85, (target - r.sp) * 2)) * dt; r.sp = Math.max(0, r.sp);
      const before = r.s; r.s += r.sp * dt;
      if (Math.floor(r.s / C.L) > Math.floor(before / C.L)) { r.lap++; if (r.lap > LAPS && !r.done) r.done = R.t; }
      const [u, v, h] = onLine(C, r.s, r.off); r.u = u; r.y = v; r.h = h;
      // a knock when you touch
      const d = gm(u - me.u, v - me.v);
      if (d < 3.2 && !me.done) { const push = (3.2 - d); const a = Math.atan2((me.v - v) / SQ, me.u - u); [me.u, me.v] = step(me.u, me.v, a, push); me.sp *= 0.75; r.sp *= 0.85;
        if (!r.hit) { snd.noise(0.18, 0.25, 700); r.hit = true; } } else r.hit = false;
    }
    if (me.done && !R.over) { R.over = true; track('game', { mode: 'race', place: place(), time: Math.round(me.done) }); setTimeout(showResult, 1200); }
  }
  const place = () => { const key = c => (c.done != null ? -1e9 + c.done : -c.p), mine = key({ done: R.me.done, p: R.me.prog });
    return 1 + R.rivals.filter(r => key({ done: r.done, p: r.s }) < mine).length; };
  const fmtT = x => x == null ? '–' : `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
  function hudTop(inner) {
    return `<div class="g-top">${inner}<button type="button" class="g-mute" aria-label="${t('gSound')}">${snd.muted ? '🔇' : '🔊'}</button><button type="button" class="g-exit" aria-label="${t('close')}">✕</button></div>`;
  }
  function bindTop() { hud.querySelector('.g-exit').onclick = stop; hud.querySelector('.g-mute').onclick = () => { toggleMute(); }; }
  function raceHud() {
    const me = R.me, lap = Math.max(1, Math.min(LAPS, me.lap)); let best = null; try { best = Number(localStorage.getItem('tt-race-best')) || null; } catch {}
    hud.innerHTML = hudTop(`<span>${t('gLap')} <b>${lap}/${LAPS}</b></span><span>${t('gPos')} <b>${place()}/4</b></span><span><b>${fmtT(Math.max(0, R.t))}</b></span><span class="g-best">${t('gBest')} ${fmtT(best)}</span>`)
      + `<div class="g-speed"><b>${Math.round(Math.abs(me.sp) * 3.6)}</b> km/h<i style="--b:${(me.boost * 100).toFixed(0)}%"></i></div>`
      + (R.t < 0 ? `<div class="g-count">${Math.ceil(-R.t)}</div>` : '')
      + R.calls.filter(c => performance.now() - c.t < 1300).slice(-1).map(c => `<div class="g-call">${c.txt}</div>`).join('')
      + (R.t < -1.5 ? `<div class="g-help">${t('gKeys')}</div>` : '');
    bindTop();
  }
  function showResult() {
    const C = R.C, rows = [{ me: true, done: R.me.done }, ...R.rivals.map(r => ({ done: r.done, s: r.s }))].sort((a, b) => (a.done ?? 1e9) - (b.done ?? 1e9) || (b.s ?? 0) - (a.s ?? 0));
    const pl = rows.findIndex(r => r.me) + 1;
    hud.innerHTML = `<div class="g-result panel"><h2>${t('gFinished')}: ${pl}/4</h2><ol>${rows.map(c => `<li class="${c.me ? 'me' : ''}">${c.me ? t('gYou') : t('gRival')} <span>${fmtT(c.done)}</span></li>`).join('')}</ol>`
      + `<p>${t('gBestLap')}: <b>${fmtT(R.me.best)}</b></p><div class="g-actions"><button type="button" class="btn" data-a="exit">${t('close')}</button><button type="button" class="btn primary" data-a="again">${t('gAgain')}</button></div></div>`;
    hud.querySelector('[data-a=exit]').onclick = stop; hud.querySelector('[data-a=again]').onclick = () => { R = newRace(C); };
    R.showing = true; snd.rev(0);
  }

  // ---------- fly ----------
  let F = null;
  function newFlight() { const [u, v] = toCamera(41.3275, 19.8187); return { u, v, th: -Math.PI / 4, sp: 55, alt: 140, trail: [], over: null, bank: 0, livery: Math.floor(Math.random() * 3) }; }
  function stepFly(dt) {
    const turn = (held('ArrowLeft', 'a') ? -1 : 0) + (held('ArrowRight', 'd') ? 1 : 0);
    if (held('ArrowUp', 'w')) F.sp = Math.min(95, F.sp + 25 * dt); if (held('ArrowDown', 's')) F.sp = Math.max(30, F.sp - 25 * dt);
    F.th += turn * 0.9 * dt; F.bank += (turn - F.bank) * Math.min(1, dt * 4);
    [F.u, F.v] = step(F.u, F.v, F.th, F.sp * dt);
    const it = item(), sz = it.getContentSize(), x = F.u - origin[0], y = F.v - origin[1];
    if (x < 2000 || y < 2000 || x > sz.x - 2000 || y > sz.y - 2000) { const want = Math.atan2((origin[1] + sz.y / 2 - F.v) / SQ, origin[0] + sz.x / 2 - F.u);
      let d = want - F.th; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; F.th += Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt); }
    F.trail.push([F.u, F.v]); if (F.trail.length > 70) F.trail.shift();
    let best = null, bd = 260 * 260;
    for (const p of landmarks()) { const [pu, pv] = toCamera(p.lat, p.lon); const d = ((pu - F.u) * MPP) ** 2 + ((pv - F.v) * MPP / SQ) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best !== F.over) { F.over = best; if (best) { snd.beep(784, 0.12, 'triangle', 0.08); track('game', { mode: 'fly', over: best.id }); } }
    snd.rev((F.sp - 30) / 65, 'plane');
  }
  function flyHud() {
    hud.innerHTML = hudTop(`<span>✈️ <b>${Math.round(F.sp * 3.6)}</b> km/h</span><span>${t('gAlt')} <b>${F.alt} m</b></span>`)
      + (F.over ? `<div class="g-call g-over">${t('gOver')} ${nm(F.over)}</div>` : '') + (performance.now() - F.t0 < 4000 ? `<div class="g-help">${t('gFlyKeys')}</div>` : '');
    bindTop();
  }

  // ---------- draw ----------
  function carSprite(u, v, th, row, size, k, ox, oy) {
    const { CAR, sheet } = data, gx = Math.cos(th), gy = Math.sin(th);
    const f = ((Math.round((45 - Math.atan2(-gy, gx) * DEG) / (360 / CAR.N)) % CAR.N) + CAR.N) % CAR.N, x = ox + u * k, y = oy + v * k;
    ctx.drawImage(sheet, f * CAR.CELL, CAR.y0 + row * CAR.CELL, CAR.CELL, CAR.CELL, x - size / 2, y - size / 2, size, size); return [x, y];
  }
  function draw() {
    if (!item()) return;
    if (cv.width !== Math.round(viewer.container.clientWidth * Math.min(2, devicePixelRatio || 1))) resize();
    const { k, ox, oy } = view(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'race' && R) {
      const C = R.C;
      ctx.save(); ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy); ctx.lineJoin = 'round';
      ctx.lineWidth = (HALF * 2 / MPP); ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.stroke(C.line);       // the track, road-wide
      ctx.lineWidth = 3 / k; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([16 / k, 14 / k]); ctx.stroke(C.line); ctx.restore();
      const [su, sv, sh] = onLine(C, 0);
      ctx.save(); ctx.translate(ox + su * k, oy + sv * k); ctx.rotate(scrAng(sh) + Math.PI / 2);
      const w = HALF * 2 / MPP * k; for (let i = 0; i < 8; i++) for (let r = 0; r < 2; r++) { ctx.fillStyle = (i + r) % 2 ? '#111' : '#fff'; ctx.fillRect(-w / 2 + i * w / 8, -4 + r * 4, w / 8, 4); } ctx.restore();
      const size = vehiclePx(CAR_M, k * dpr) * (data.CAR.VIEW / CAR_M) * 1.3 / dpr;
      const all = [...R.rivals.map(r => ({ u: r.u, v: r.y, th: r.h, row: r.row })), { u: R.me.u, v: R.me.v, th: R.me.th, row: 0, me: true }].sort((a, b) => a.v - b.v);
      for (const c of all) { const [x, y] = carSprite(c.u, c.v, c.th, c.row, size, k, ox, oy);
        if (c.me) { ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - size * 0.62); ctx.lineTo(x - 7, y - size * 0.62 - 10); ctx.lineTo(x + 7, y - size * 0.62 - 10); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
    }
    if (mode === 'fly' && F) {
      const { plane, shadow, PL } = data, m = k / MPP, lift = F.alt * SQ / MPP * k * 0.35;
      const cell = Math.max(96, 44 * m) * PL.VIEW / 34;                                 // a toy ~44 m wingspan, never tiny
      const bearing = ((45 + F.th * DEG) % 360 + 360) % 360, f = Math.round(bearing / (360 / PL.N)) % PL.N;
      const gx = ox + F.u * k, gy = oy + F.v * k;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath();
      F.trail.forEach(([u, v], i) => { const x = ox + u * k, y = oy + v * k - lift; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      if (plane) {
        ctx.globalAlpha = 0.38; ctx.drawImage(shadow, f * PL.CELL, 0, PL.CELL, PL.CELL, gx - cell / 2, gy - cell / 2 * SQ, cell, cell * SQ); ctx.globalAlpha = 1;
        ctx.drawImage(plane, f * PL.CELL, F.livery * PL.CELL, PL.CELL, PL.CELL, gx - cell / 2, gy - lift - cell / 2, cell, cell);
      }
    }
  }
  function follow(u, v) { const it = item(), p = it.imageToViewportCoordinates(u - origin[0], v - origin[1]); viewer.viewport.panTo(p, true); }
  function loop(ts) {
    raf = 0; if (!mode) return;
    const dt = Math.min(0.05, lastT ? (ts - lastT) / 1000 : 0); lastT = ts;
    if (mode === 'race') { if (!R.showing) { stepRace(dt); raceHud(); } const me = R.me; follow(...step(me.u, me.v, me.th, Math.max(0, me.sp) * 0.9)); }
    else { stepFly(dt); flyHud(); follow(...step(F.u, F.v, F.th, 120)); }
    draw(); raf = requestAnimationFrame(loop);
  }
  async function start(m) {
    try { await load(); } catch (e) { console.warn('[game]', e); return; }
    mode = m; keys.clear(); lastT = 0; document.body.classList.add('playing'); button.setAttribute('aria-pressed', 'true');
    viewer.setMouseNavEnabled(false); hud.hidden = false; pad.hidden = false; resize(); snd.engine(true, m === 'race' ? 'car' : 'plane');
    const it = item();
    if (m === 'race') {
      data.C ??= buildCircuit(data.roads); R = newRace(data.C);
      pad.innerHTML = `<div class="g-steer">${padBtn('◀', 'ArrowLeft')}${padBtn('▶', 'ArrowRight')}</div><div class="g-pedals">${padBtn(t('gBrake'), 'ArrowDown', 'brake')}${padBtn('⚡', ' ', 'boost')}${padBtn(t('gGas'), 'ArrowUp', 'gas')}</div>`;
      viewer.viewport.zoomTo(it.imageToViewportZoom(0.72), null, true); follow(R.me.u, R.me.v);
    } else {
      F = newFlight(); F.t0 = performance.now();
      pad.innerHTML = `<div class="g-steer">${padBtn('↺', 'ArrowLeft')}${padBtn('↻', 'ArrowRight')}</div><div class="g-pedals">${padBtn('−', 'ArrowDown')}${padBtn('+', 'ArrowUp', 'gas')}</div>`;
      viewer.viewport.zoomTo(it.imageToViewportZoom(0.22), null, true);
    }
    track('game', { mode: m, start: true });
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    mode = null; R = null; F = null; cancelAnimationFrame(raf); raf = 0; keys.clear(); snd.engine(false);
    hud.hidden = true; pad.hidden = true; menu.hidden = true; hud.innerHTML = ''; document.body.classList.remove('playing');
    button.setAttribute('aria-pressed', 'false'); viewer.setMouseNavEnabled(true);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  }
  addEventListener('resize', () => { if (mode) resize(); });
  return { start, stop, get mode() { return mode; } };
}
