// A light trickle of toy cars on Tirana's main roads (trunk / primary / secondary / tertiary only), drawn by life.js on its
// canvas. Data: life/roads.json (post/life_bake.py --roads), CAMERA px at true street level, with the stretches of every lane
// that a building or tree hides from the camera (height-pass depth test): cars fade out there instead of being drawn on top.
// Roads end in PORTALS (the painting's edge, or where a main road meets side streets we leave out): cars fade out there and
// new ones fade in, as if turning off into a side street. Sprites: life/cars.{avif,webp} (render/sprites/make_life.mjs).
//
// Every car drives a ROUTE: it gets a destination (a portal where it will leave the map) and follows the shortest path
// there over the directed graph (reverse Dijkstra per destination, cached), so it never circles; as a hard rule a car that
// would pass the same junction twice within 60 s is re-routed at once. On roundabouts cars give way on entry to cars already
// circulating and leave at their exit. Motion runs on directed edges with an IDM-style driver (smooth acceleration,
// comfortable braking, slowing for curves to <= 2 m/s^2 lateral, per-driver variation) and Bezier arcs through junctions.
// Car-following in each lane, and near junctions a small 2D look-around (fixed hash grid, no allocation) so cars from
// different streets never drive through each other. Buses (vehicles.js busesNow, published by
// buses.js every frame) are obstacles too: a bus in a car's path is followed and queued behind; on two-lane one-ways the car
// pulls out and passes it if the other lane is free. Every car on the road is published in vehicles.js carsNow (camera px)
// so buses can follow cars; as a safety net a slow car with a bus stuck right behind it for ~8 s pulls over to the curb,
// waits for the bus to pass and rejoins. Sizes come from the shared vehiclePx scale, in proportion with the buses.
// Hidden cars (behind a building or under trees) fade out; the followed one keeps an x-ray outline. A tapped car opens a card with "Follow".

import { vehiclePx, busesNow, carsNow, follow } from './vehicles.js';

const SQ = Math.SQRT1_2, DEG = 180 / Math.PI;
const MAX_CARS = matchMedia('(pointer: coarse)').matches ? 170 : 340;   // city-wide (phones: half, their CPUs pay per car per frame)
const SPEED = [12, 10, 8.5];                              // m/s: primary/trunk, secondary, tertiary
const DENSITY = [6, 3, 3];                                // cars per km of road (both directions): a calm Sunday morning
const LANE_OFF = 1.7, LANE_W = 3.2, CAR_GAP = 6.4, HEADWAY = 1.2;   // m right of the centre line (two-way), lane width, gap, s
const ACC = 2.5, BRAKE = 4, LAT = 2, S0 = 2;              // m/s^2 accelerate, comfortable braking, lateral; m bumper gap when stopped
const J = 6;                                              // m before / after a junction where the car follows a Bezier arc
const TRACE = new URLSearchParams(location.search).has('cartrace');
const REVISIT_S = 60;                                     // s: passing the same junction again within this is a loop
const ROWS_W = [3, 1, 4, 2, 1, 1, 2, 3];                  // paint frequency per sheet row (whites/silvers are common)
const CAR_M = 4.3;                                        // true car length (the sedan model) for the shared vehicle scale
const FADE = 3, PORTAL_FADE = 10;                         // metres of fade at hidden stretches / portals

export function makeCars({ roads, meta, sheet, rnd, viewer, origin, redraw }) {
  const MPP = roads.mpp, PXM = 1 / MPP, CAR = meta.car;
  // ---------------- graph ----------------
  const V = roads.verts.length / 2, E = roads.edges.length;
  const eA = new Int32Array(E), eB = new Int32Array(E), eCls = new Uint8Array(E), eFlags = new Uint8Array(E), eLanes = new Uint8Array(E);
  const eStart = new Int32Array(E), eCnt = new Int32Array(E), eLen = new Float32Array(E), eBox = new Float32Array(4 * E);
  let nPts = 0; for (const e of roads.edges) nPts += 2 + e[5].length / 2;
  const PU = new Float32Array(nPts), PV = new Float32Array(nPts), CUM = new Float32Array(nPts);
  { let k = 0;
    roads.edges.forEach(([a, b, cls, flags, lanes, dl], i) => {
      eA[i] = a; eB[i] = b; eCls[i] = Math.min(2, cls); eFlags[i] = flags; eLanes[i] = lanes; eStart[i] = k;
      let u = roads.verts[2 * a], v = roads.verts[2 * a + 1]; PU[k] = u; PV[k] = v; CUM[k] = 0; k++;
      const push = (nu, nv) => { CUM[k] = CUM[k - 1] + Math.hypot(nu - PU[k - 1], (nv - PV[k - 1]) / SQ) * MPP; PU[k] = nu; PV[k] = nv; k++; };
      for (let j = 0; j < dl.length; j += 2) { u += dl[j]; v += dl[j + 1]; push(u, v); }
      push(roads.verts[2 * b], roads.verts[2 * b + 1]);
      eCnt[i] = k - eStart[i]; eLen[i] = Math.max(0.5, CUM[k - 1]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = eStart[i]; j < k; j++) { x0 = Math.min(x0, PU[j]); x1 = Math.max(x1, PU[j]); y0 = Math.min(y0, PV[j]); y1 = Math.max(y1, PV[j]); }
      eBox[4 * i] = x0; eBox[4 * i + 1] = y0; eBox[4 * i + 2] = x1; eBox[4 * i + 3] = y1;
    });
  }
  // hidden stretches per directed lane (forward metres)
  const hOff = new Int32Array(2 * E + 1);
  roads.edges.forEach((e, i) => { hOff[2 * i + 1] = hOff[2 * i] + (e[6]?.length || 0); hOff[2 * i + 2] = hOff[2 * i + 1] + (e[7]?.length || 0); });
  const HID = new Float32Array(hOff[2 * E]);
  roads.edges.forEach((e, i) => { HID.set((e[6] || []).map(x => x / 10), hOff[2 * i]); HID.set((e[7] || []).map(x => x / 10), hOff[2 * i + 1]); });
  // directed edge d = 2e (a -> b) or 2e + 1 (b -> a, two-way roads only)
  const dOK = d => !((eFlags[d >> 1] & 1) && (d & 1));
  const dFrom = d => (d & 1 ? eB[d >> 1] : eA[d >> 1]), dTo = d => (d & 1 ? eA[d >> 1] : eB[d >> 1]);
  const portal = new Uint8Array(V), outCnt = new Int32Array(V + 1);
  for (let e = 0; e < E; e++) {
    if (eFlags[e] & 4) portal[eA[e]] = 1; if (eFlags[e] & 8) portal[eB[e]] = 1;
    outCnt[eA[e] + 1]++; if (!(eFlags[e] & 1)) outCnt[eB[e] + 1]++;
  }
  for (let v = 0; v < V; v++) outCnt[v + 1] += outCnt[v];
  const outList = new Int32Array(outCnt[V]), fill = outCnt.slice(0, V);
  for (let e = 0; e < E; e++) { outList[fill[eA[e]]++] = 2 * e; if (!(eFlags[e] & 1)) outList[fill[eB[e]]++] = 2 * e + 1; }
  const entries = [];
  for (let d = 0; d < 2 * E; d++) if (dOK(d) && portal[dFrom(d)] && !portal[dTo(d)]) entries.push(d);
  const inCnt = new Int32Array(V + 1);
  for (let d = 0; d < 2 * E; d++) if (dOK(d)) inCnt[dTo(d) + 1]++;
  for (let v = 0; v < V; v++) inCnt[v + 1] += inCnt[v];
  const inList = new Int32Array(inCnt[V]), fillIn = inCnt.slice(0, V);
  for (let d = 0; d < 2 * E; d++) if (dOK(d)) inList[fillIn[dTo(d)]++] = d;
  const ring = e => (eFlags[e] & 16) !== 0;
  const allExits = []; for (let v = 0; v < V; v++) if (portal[v] && inCnt[v + 1] > inCnt[v]) allExits.push(v);
  // destinations: a fixed sample of the exits (each costs one cached reverse Dijkstra), so a big city graph stays cheap
  const exits = allExits.length <= 48 ? allExits : allExits.map(v => [rnd(), v]).sort((a, b) => a[0] - b[0]).slice(0, 48).map(x => x[1]);
  const tanStart = new Float32Array(4 * E), tanEnd = new Float32Array(4 * E);
  const unit = (out, o, ax, ay, bx, by) => { const x = bx - ax, y = (by - ay) / SQ, l = Math.hypot(x, y) || 1; out[o] = x / l; out[o + 1] = y / l; };
  for (let e = 0; e < E; e++) {
    const s = eStart[e], t = s + eCnt[e] - 1;
    unit(tanStart, 4 * e, PU[s], PV[s], PU[s + 1], PV[s + 1]); unit(tanEnd, 4 * e, PU[t - 1], PV[t - 1], PU[t], PV[t]);
    unit(tanStart, 4 * e + 2, PU[t], PV[t], PU[t - 1], PV[t - 1]); unit(tanEnd, 4 * e + 2, PU[s + 1], PV[s + 1], PU[s], PV[s]);
  }
  const tanIdx = d => 4 * (d >> 1) + 2 * (d & 1);
  const pickW = d => DENSITY[eCls[d >> 1]] * SPEED[eCls[d >> 1]] / ((eFlags[d >> 1] & 1) ? 1 : 2);   // keeps the class mix steady
  const turnW = cos => { const k = Math.max(0.02, (1 + cos) / 2); return k * k * k; };             // straight on >> turns >> hairpins
  const perDir = d => ((eFlags[d >> 1] & 1) && eCls[d >> 1] <= 1 && eLanes[d >> 1] >= 2 ? 2 : 1);
  const laneOffset = (d, lane) => (eFlags[d >> 1] & 1 ? (perDir(d) === 1 ? 0 : (lane - 0.5) * LANE_W) : LANE_OFF);

  let SX = 0, SY = 0;                                     // pointAt result, camera px
  function pointAt(d, s) {
    const e = d >> 1, len = eLen[e], sf = d & 1 ? len - s : s, a = eStart[e], n = eCnt[e];
    if (sf <= 0) { SX = PU[a]; SY = PV[a]; return; }
    if (sf >= len) { SX = PU[a + n - 1]; SY = PV[a + n - 1]; return; }
    let lo = a, hi = a + n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (CUM[m] <= sf) lo = m; else hi = m; }
    const k = (sf - CUM[lo]) / ((CUM[hi] - CUM[lo]) || 1);
    SX = PU[lo] + (PU[hi] - PU[lo]) * k; SY = PV[lo] + (PV[hi] - PV[lo]) * k;
  }
  function routeAt(c, ds) {
    const s = c.s + ds;
    if (s > eLen[c.d >> 1] && c.next >= 0) return pointAt(c.next, Math.min(s - eLen[c.d >> 1], eLen[c.next >> 1]));
    if (s < 0 && c.prev >= 0) return pointAt(c.prev, Math.max(0, eLen[c.prev >> 1] + s));
    pointAt(c.d, s);
  }
  // centre line point at s + ds along the car's route, with a quadratic Bezier arc through each junction (J m either side)
  function posAt(c, ds) {
    const s = c.s + ds, d = c.d, L = eLen[d >> 1];
    if (c.next >= 0 && L - s < J && s - L < J) {
      const j = Math.min(J, L / 2, eLen[c.next >> 1] / 2), x = s - L;
      if (x > -j && x < j) { pointAt(d, L - j); const ax = SX, ay = SY; pointAt(d, L); const bx = SX, by = SY; pointAt(c.next, j); return bez(ax, ay, bx, by, SX, SY, (x + j) / (2 * j)); }
    }
    if (c.prev >= 0 && s < J && s > -J) {
      const j = Math.min(J, L / 2, eLen[c.prev >> 1] / 2);
      if (s > -j && s < j) { pointAt(c.prev, eLen[c.prev >> 1] - j); const ax = SX, ay = SY; pointAt(d, 0); const bx = SX, by = SY; pointAt(d, j); return bez(ax, ay, bx, by, SX, SY, (s + j) / (2 * j)); }
    }
    routeAt(c, ds);
  }
  function bez(ax, ay, bx, by, cx, cy, t) { const u = 1 - t; SX = u * u * ax + 2 * u * t * bx + t * t * cx; SY = u * u * ay + 2 * u * t * by + t * t * cy; }
  function cover(c) {                                     // 1 in view, 0 hidden (behind a building / under trees)
    const d = c.d, e = d >> 1, len = eLen[e], s = c.s, sf = d & 1 ? len - s : s; let a = 1;
    for (let i = hOff[d]; i < hOff[d + 1]; i += 2) a = Math.min(a, Math.max(0, Math.max(HID[i] - sf, sf - HID[i + 1]) / FADE));
    return a;
  }
  function portalFade(c) {                                // fade in / out where a car comes from / turns off into a side street
    const d = c.d, len = eLen[d >> 1]; let a = 1;
    if (portal[dFrom(d)] && c.prev < 0) a = Math.min(a, c.s / PORTAL_FADE);
    if (portal[dTo(d)] && c.next < 0) a = Math.min(a, (len - c.s) / PORTAL_FADE);
    return Math.max(0, Math.min(1, a));
  }

  // ---------------- cars ----------------
  let followed = null, open = null, tip = null;          // the followed car and the open card (see the bottom)
  let now = 0;                                            // sim seconds
  const carsOn = new Array(2 * E), onEdge = d => (carsOn[d] ??= []);
  const rowPick = []; ROWS_W.forEach((w, r) => { for (let i = 0; i < w; i++) rowPick.push(r); });
  const cars = [];
  // ---------------- routing: reverse Dijkstra per destination vertex, cached ----------------
  // nh[d] = the directed edge to take after d to reach the destination fastest (time + turn penalty), -1 if unreachable.
  const routes = new Map();
  function routeTo(t) {
    let R = routes.get(t); if (R) return R;
    const n = 2 * E, dist = new Float64Array(n).fill(Infinity), nh = new Int32Array(n).fill(-1);
    const heap = [], push = (d, k) => { heap.push([k, d]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (let i = inCnt[t]; i < inCnt[t + 1]; i++) { const d = inList[i]; dist[d] = 0; push(d, 0); }
    while (heap.length) {
      const [k, o] = pop(); if (k > dist[o]) continue;
      const from = dFrom(o), cost = k + eLen[o >> 1] / SPEED[eCls[o >> 1]];
      for (let i = inCnt[from]; i < inCnt[from + 1]; i++) {
        const d = inList[i]; if ((d >> 1) === (o >> 1) || dTo(d) === t) continue;        // no U-turns; arrived edges stay 0
        const a = tanIdx(d), b = tanIdx(o), cos = tanEnd[a] * tanStart[b] + tanEnd[a + 1] * tanStart[b + 1];
        const nd = cost + (1 - cos) * 3;                                                  // a sharp turn costs a few seconds
        if (nd < dist[d]) { dist[d] = nd; nh[d] = o; push(d, nd); }
      }
    }
    R = { dist, nh }; routes.set(t, R); return R;
  }
  // A route is only taken if it is SIMPLE: it never passes a junction twice, nor one the car passed in the last minute.
  // (With no U-turns, a destination behind the car could otherwise mean a lap round a roundabout or a block.)
  const mark = new Int32Array(V); let stamp = 0;
  function routeOK(c, d, t, strict = true) {
    const R = routeTo(t); stamp++; mark[dFrom(d)] = stamp;
    let e = d, n = 0;
    for (;;) {
      const v = dTo(e); if (mark[v] === stamp || (strict && seen(c, v))) return false; mark[v] = stamp;
      if (v === t) return true;
      e = R.nh[e]; if (e < 0 || ++n > 600) return false;
    }
  }
  const NOBODY = { hn: new Int32Array(12).fill(-1), ht: new Float32Array(12) };
  const wayOutMemo = new Int8Array(2 * E);                // 1 yes / -1 no: some exit is reachable by a simple route from d
  function wayOut(d) {
    if (!wayOutMemo[d]) { wayOutMemo[d] = -1; for (const t of exits) if (t !== dFrom(d) && routeTo(t).dist[d] < Infinity && routeOK(NOBODY, d, t, false)) { wayOutMemo[d] = 1; break; } }
    return wayOutMemo[d] > 0 || portal[dTo(d)] === 1;
  }
  function assignDest(c, d, avoid = -1) {                // a reachable exit by a simple route, preferably a long drive away
    let best = -1, bestT = -1;
    for (let pass = 0; pass < 3 && best < 0; pass++) {    // 1: random, simple and clear of recent junctions; 2: every exit; 3: just simple
      const n = pass === 0 ? 24 : exits.length;
      for (let i = 0; i < n && exits.length; i++) {
        const t = pass === 0 ? exits[Math.floor(rnd() * exits.length)] : exits[i]; if (t === avoid || t === dTo(d) || t === dFrom(d)) continue;
        const T = routeTo(t).dist[d]; if (!(T < Infinity) || T <= bestT || !routeOK(c, d, t, pass < 2)) continue;
        best = t; bestT = T; if (pass === 0 && T > 90) break;
      }
    }
    c.dest = best;
  }
  function nextFor(c, d) {                               // follow the route; at the destination leave (a followed car drives on)
    for (let k = 0; k < 2; k++) {
      if (c.dest >= 0 && dTo(d) === c.dest) { if (c !== followed) return -1; assignDest(c, d, c.dest); continue; }
      if (c.dest >= 0) { const o = routeTo(c.dest).nh[d]; if (o >= 0) return o; }
      assignDest(c, d);
    }
    return pickNext(d);
  }
  function seen(c, v) {                                  // passed junction v within REVISIT_S?
    for (let i = 0; i < 12; i++) if (c.hn[i] === v && now - c.ht[i] < REVISIT_S) return true;
    return false;
  }
  function pickNext(d) {
    const v = dTo(d), ti = tanIdx(d), tx = tanEnd[ti], ty = tanEnd[ti + 1];
    let total = 0;
    for (let i = outCnt[v]; i < outCnt[v + 1]; i++) {
      const o = outList[i]; if ((o >> 1) === (d >> 1)) continue;
      const oi = tanIdx(o); total += pickW(o) * turnW(tx * tanStart[oi] + ty * tanStart[oi + 1]);
    }
    if (total === 0) return portal[v] ? -1 : (dOK(d ^ 1) ? d ^ 1 : -1);      // never back the way it came unless a true dead end
    let r = rnd() * total;
    for (let i = outCnt[v]; i < outCnt[v + 1]; i++) {
      const o = outList[i]; if ((o >> 1) === (d >> 1)) continue;
      const oi = tanIdx(o); r -= pickW(o) * turnW(tx * tanStart[oi] + ty * tanStart[oi + 1]); if (r <= 0) return o;
    }
    for (let i = outCnt[v + 1] - 1; i >= outCnt[v]; i--) if ((outList[i] >> 1) !== (d >> 1)) return outList[i];
    return -1;
  }
  function removeFrom(d, c) { const a = carsOn[d], i = a.indexOf(c); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } }
  function freeAt(d, s, lane) { for (const o of onEdge(d)) if (o.lane === lane && Math.abs(o.s - s) < CAR_GAP + 3) return false; return true; }
  function roomAhead(d, s, lane) { let g = Infinity; for (const o of onEdge(d)) if (o.lane === lane && o.s >= s) g = Math.min(g, o.s - s); return g; }
  function enter(c, d, s) {
    if (perDir(d) === 1) c.lane = 0;
    else { const l0 = Math.min(1, c.lane), r0 = roomAhead(d, s, l0), r1 = roomAhead(d, s, 1 - l0); c.lane = r1 > r0 + 10 ? 1 - l0 : l0; }
    c.d = d; c.s = s; c.offT = laneOffset(d, c.lane); onEdge(d).push(c); c.vmax = SPEED[eCls[d >> 1]] * c.k;
    if (c.dest < 0) assignDest(c, d);
    c.next = nextFor(c, d);
    // hard rule: never pass the same junction twice within a minute (e.g. a full lap of a roundabout): re-route now,
    // preferring a way out that is not on the ring
    const v = dTo(d);
    if (c.next >= 0 && (seen(c, dTo(c.next)) || dTo(c.next) === dFrom(d))) {   // the junction after next was passed lately: take another way
      c.revisits++; let alt = -1;
      for (let i = outCnt[v]; i < outCnt[v + 1]; i++) { const o = outList[i]; if ((o >> 1) !== (d >> 1) && !ring(o >> 1) && !seen(c, dTo(o))) { alt = o; break; } }
      if (alt < 0) for (let i = outCnt[v]; i < outCnt[v + 1]; i++) { const o = outList[i]; if ((o >> 1) !== (d >> 1) && !seen(c, dTo(o))) { alt = o; break; } }
      if (alt >= 0) { c.next = alt; c.dest = -1; assignDest(c, alt); }
    }
    if (c === followed && c.next < 0 && dOK(d ^ 1)) c.next = d ^ 1;                    // a followed car turns round instead of leaving
    if (c.prev >= 0 && seen(c, dFrom(d))) { c.looped++; if (TRACE) (c.trace ??= []).push(['LOOP', dFrom(d)]); }   // (diagnostics: an actual repeat)
    if (TRACE) (c.trace ??= []).push([+now.toFixed(1), c.prev, d, c.next, c.dest, dFrom(d), dTo(d), ring(d >> 1) ? 1 : 0]);
    c.hn[c.hi] = dFrom(d); c.ht[c.hi] = now; c.hi = (c.hi + 1) % 12;                     // junction history (no allocation)
  }
  function respawn(c) {
    for (let tries = 0; tries < 6 && entries.length; tries++) {
      const d = entries[Math.floor(rnd() * entries.length)], lane = Math.floor(rnd() * perDir(d));
      if (freeAt(d, 0, lane) && wayOut(d)) {
        c.prev = -1; c.lane = lane; c.dest = -1; c.hn.fill(-1); enter(c, d, 0); c.off = c.offT; place(c);
        if (busesNow.length && busNearSpawn(c)) { removeFrom(d, c); continue; }               // never appear on top of a bus
        c.v = c.vmax * 0.6; c.out = false; c.wait = 0; return true;
      }
    }
    return false;
  }
  { // initial spread, by road length x density, on free spots only
    const ds = [], w = []; let tot = 0;
    for (let d = 0; d < 2 * E; d++) if (dOK(d) && !(eFlags[d >> 1] & 2)) { tot += eLen[d >> 1] / 1000 * DENSITY[eCls[d >> 1]] / ((eFlags[d >> 1] & 1) ? 1 : 2); ds.push(d); w.push(tot); }
    const n = Math.min(MAX_CARS, Math.round(tot));
    for (let i = 0; i < n * 3 && cars.length < n; i++) {
      const r = rnd() * tot; let lo = 0, hi = w.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < r) lo = m + 1; else hi = m; }
      const d = ds[lo], s = rnd() * eLen[d >> 1], lane = Math.floor(rnd() * perDir(d));
      if (!freeAt(d, s, lane) || !wayOut(d)) continue;      // not inside a turning loop (a dead end that ends in a roundabout)
      const c = { id: cars.length, d: -1, prev: -1, next: -1, s: 0, v: 0, vmax: 0, k: 0.85 + rnd() * 0.25, lane,
                  acc: ACC * (0.85 + rnd() * 0.3), hw: HEADWAY * (0.85 + rnd() * 0.35), dest: -1, hn: new Int32Array(12).fill(-1), ht: new Float32Array(12), hi: 0, revisits: 0, looped: 0, off: 0, offT: 0, wait: 0, out: false, busT: 0, pull: 0, pullT: 0, pullLane: 0,
                  pub: { u: 0, v: 0, hx: 1, hy: 0, len: CAR_M * PXM, v_mps: 0 }, row: rowPick[Math.floor(rnd() * rowPick.length)], x: 0, y: 0, f: 0, a: 1, seen: -1, zone: false, jx: 0, jy: 0, hx: 1, hy: 0 };
      enter(c, d, s); c.off = c.offT; c.v = c.vmax * 0.5; cars.push(c);
    }
  }
  // near junctions cars also look around in 2D: anyone just ahead and in my path is my leader
  const ZONE = 14, HB = 1024, hHead = new Int32Array(HB), hNext = new Int32Array(MAX_CARS + 1), CELL = 8 * PXM;
  const hcell = (ix, iy) => ((ix * 73856093) ^ (iy * 19349663)) & (HB - 1);
  function place(c) {
    posAt(c, -1.5); const ax = SX, ay = SY; posAt(c, 1.5); const bx = SX, by = SY; posAt(c, 0);
    let gx = bx - ax, gy = (by - ay) / SQ; const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    c.hx = gx; c.hy = gy; c.jx = SX - gy * c.off * PXM; c.jy = SY / SQ + gx * c.off * PXM;
  }
  const MAXB = 512, BUS = new Float32Array(4 * MAXB), BUSL = new Float32Array(MAXB);
  function segDist(px, py, i) {                           // metres from ground point to bus i's centre line
    const o = 4 * i, hl = BUSL[i] * PXM, ax = BUS[o] - BUS[o + 2] * hl, ay = BUS[o + 1] - BUS[o + 3] * hl;
    let t = ((px - ax) * BUS[o + 2] + (py - ay) * BUS[o + 3]) / (2 * hl); t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - BUS[o + 2] * 2 * hl * t, py - ay - BUS[o + 3] * 2 * hl * t) * MPP;
  }
  function overBus(c, i) {                                // is my body already inside bus i's footprint? (then it is not an obstacle:
    const o = 4 * i, dx = (c.jx - BUS[o]) * MPP, dy = (c.jy - BUS[o + 1]) * MPP;   // treating it as one deadlocks us both)
    const al = dx * BUS[o + 2] + dy * BUS[o + 3];              // > 0: I am in its front half (drive out); < 0: rear half (brake,
    return al > 0 && al < BUSL[i] + CAR_M / 2 - 0.3 && Math.abs(dy * BUS[o + 2] - dx * BUS[o + 3]) < 1.9;   // the bus pulls away)
  }
  function inAnyBus(c, nb) {
    for (let i = 0; i < Math.min(nb, MAXB); i++) {
      const o = 4 * i, dx = (c.jx - BUS[o]) * MPP, dy = (c.jy - BUS[o + 1]) * MPP;
      if (Math.abs(dx * BUS[o + 2] + dy * BUS[o + 3]) < BUSL[i] + CAR_M / 2 - 0.5 && Math.abs(dy * BUS[o + 2] - dx * BUS[o + 3]) < 1.4) return true;
    }
    return false;
  }
  function busNearSpawn(c) {                               // a bus within 15 m of this spot (busesNow: camera px, v squashed)
    for (const q of busesNow) { const dx = (q.u - c.jx) * MPP, dy = (q.v / SQ - c.jy) * MPP; if (dx * dx + dy * dy < 15 * 15) return true; }
    return false;
  }
  function busOver(c, nb) {                              // is my body inside a bus's footprint (12 x 2.5 m vs 4.3 x 1.8 m)?
    for (let i = 0; i < Math.min(nb, MAXB); i++) {
      const o = 4 * i, dx = (c.jx - BUS[o]) * MPP, dy = (c.jy - BUS[o + 1]) * MPP;
      const al = dx * BUS[o + 2] + dy * BUS[o + 3], sd = Math.abs(dy * BUS[o + 2] - dx * BUS[o + 3]);
      if (Math.abs(al) < BUSL[i] + CAR_M / 2 - 0.3 && sd < 2.0) return true;
    }
    return false;
  }
  function busAhead(c, nb) {                              // metres along my heading to the first bus within 2.1 m of my path
    let best = Infinity;
    for (let i = 0; i < Math.min(nb, MAXB); i++) {
      const dx = (BUS[4 * i] - c.jx) * MPP, dy = (BUS[4 * i + 1] - c.jy) * MPP;
      if (dx * dx + dy * dy > 45 * 45 || dx * c.hx + dy * c.hy < -BUSL[i] || overBus(c, i)) continue;   // already inside it: drive out
      for (let t = 1.5; t < Math.min(best, 32); t += 1.5)
        if (segDist(c.jx + c.hx * t * PXM, c.jy + c.hy * t * PXM, i) < 2.1) { best = t; break; }
    }
    return best;
  }
  function busBehind(c, nb) {                             // a bus right behind me (same way, my lane, within ~1.5 car lengths)
    for (let i = 0; i < Math.min(nb, MAXB); i++) {
      const o = 4 * i, dx = (BUS[o] - c.jx) * MPP, dy = (BUS[o + 1] - c.jy) * MPP;
      if (dx * dx + dy * dy > 30 * 30 || BUS[o + 2] * c.hx + BUS[o + 3] * c.hy < 0.7) continue;
      const along = dx * c.hx + dy * c.hy, side = Math.abs(dy * c.hx - dx * c.hy);
      if (along < 0 && -along - BUSL[i] < 1.5 * CAR_M && side < 2.2) return true;
    }
    return false;
  }
  function busNear(c, nb) {                               // a bus still behind or alongside (don't pull back out yet)
    for (let i = 0; i < Math.min(nb, MAXB); i++) {
      const o = 4 * i, dx = (BUS[o] - c.jx) * MPP, dy = (BUS[o + 1] - c.jy) * MPP;
      if (dx * dx + dy * dy > 40 * 40) continue;
      const along = dx * c.hx + dy * c.hy, side = Math.abs(dy * c.hx - dx * c.hy);
      if (along > -(BUSL[i] + 10) && along < BUSL[i] + 3 && side < 4.8) return true;
    }
    return false;
  }
  function laneBus(c, lane, nb) {                         // is there a bus beside / ahead in that lane?
    const dOff = (laneOffset(c.d, lane) - c.off) * PXM, px = c.jx - c.hy * dOff, py = c.jy + c.hx * dOff;
    for (let i = 0; i < Math.min(nb, MAXB); i++) for (let t = -10; t < 24; t += 2) if (segDist(px + c.hx * t * PXM, py + c.hy * t * PXM, i) < 2.1) return true;
    return false;
  }
  let frame = 0;
  // speed allowed now so the car can still slow to each curve's limit ahead (lateral accel <= LAT, comfortable braking)
  const CX = new Float32Array(6), CY = new Float32Array(6);
  function curveLimit(c) {
    for (let i = 0; i < 6; i++) { posAt(c, i * 6); CX[i] = SX; CY[i] = SY / SQ; }
    let lim = Infinity;
    for (let i = 1; i < 5; i++) {
      const ax = CX[i] - CX[i - 1], ay = CY[i] - CY[i - 1], bx = CX[i + 1] - CX[i], by = CY[i + 1] - CY[i];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by); if (la < 1e-3 || lb < 1e-3) continue;
      const th = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
      if (th < 0.05) continue;
      const R = 6 / th, vc = Math.sqrt(LAT * R), x = Math.max(0, i * 6 - 3);
      lim = Math.min(lim, Math.sqrt(vc * vc + 2 * 3 * x));
    }
    return lim;
  }
  function step(dt) {
    now += dt;
    hHead.fill(-1);
    const nb = busesNow.length;
    carsNow.length = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c.out) { c.zone = false; continue; }
      c.zone = c.s < ZONE || eLen[c.d >> 1] - c.s < ZONE;
      place(c);                                            // every car: published for the buses (reused object, camera px)
      const q = c.pub; let hx = c.hx, hy = c.hy * SQ; const hl = Math.hypot(hx, hy) || 1;
      q.u = c.jx; q.v = c.jy * SQ; q.hx = hx / hl; q.hy = hy / hl; q.v_mps = c.v; q.pull = c.pull ? 1 : 0; carsNow.push(q);
      if (!c.zone) continue;
      const h = hcell(Math.floor(c.jx / CELL), Math.floor(c.jy / CELL)); hNext[i] = hHead[h]; hHead[h] = i;
    }
    for (let i = 0; i < Math.min(nb, MAXB); i++) {          // buses on the ground plane: centre, heading, half length (metres)
      const q = busesNow[i], o = 4 * i; let hx = q.hx, hy = q.hy / SQ; const hl = Math.hypot(hx, hy) || 1;
      BUS[o] = q.u; BUS[o + 1] = q.v / SQ; BUS[o + 2] = hx / hl; BUS[o + 3] = hy / hl; BUSL[i] = (q.len || 12 * PXM) * MPP / 2;
    }
    for (const c of cars) {
      if (!c.out && c.wait > 15 && c.seen < frame - 2 && c !== followed) { removeFrom(c.d, c); c.out = true; }   // unstick, off screen only
      if (c.out) { if (!respawn(c)) continue; }
      if (c.pull) {                                          // pulled over for a bus: stand at the curb until it has gone by
        c.pullT += dt; c.v = Math.max(0, c.v - 6 * dt); c.wait = 0;
        c.off += Math.max(-2.5 * dt, Math.min(2.5 * dt, c.offT - c.off));
        if (c.pullT > 3 && !(nb && busNear(c, nb)) && freeAt(c.d, c.s, c.pullLane)) { c.pull = 0; c.busT = 0; c.lane = c.pullLane; c.offT = laneOffset(c.d, c.lane); }
        continue;
      }
      // a car still inside a bus after 1.5 s (a bus that appeared on top of it): retire it under the bus, it respawns elsewhere
      c.inBusT = nb && inAnyBus(c, nb) ? (c.inBusT || 0) + dt : 0;
      if (c.inBusT > 1.5 && c !== followed) { removeFrom(c.d, c); c.out = true; c.inBusT = 0; continue; }
      if (nb && c.v < 2 && busBehind(c, nb)) c.busT += dt; else c.busT = Math.max(0, c.busT - 2 * dt);
      if (c.busT > 8 && c !== followed) {                    // a bus has been stuck right behind me: pull over to the curb
        c.pull = 1; c.pullT = 0; c.pullLane = c.lane; c.lane = -1;
        c.offT = (eFlags[c.d >> 1] & 1 ? (perDir(c.d) === 2 ? 0.5 * LANE_W : 0) : LANE_OFF) + 2.4;
        continue;
      }
      const len = eLen[c.d >> 1];
      const merge = c.next >= 0 && len - c.s < 20 && perDir(c.next) < perDir(c.d);                 // two lanes squeeze into one
      let gap = Infinity;
      let vl = 0;                                             // speed of whatever is ahead (0 for stop lines and unknowns)
      for (const o of carsOn[c.d]) if (o !== c && (merge || o.lane === c.lane) && o.s > c.s && o.s - c.s < gap) { gap = o.s - c.s; vl = o.v; }
      if (gap === Infinity && c.next >= 0 && carsOn[c.next] && c.wait < 10) for (const o of carsOn[c.next]) if (len - c.s + o.s < gap) { gap = len - c.s + o.s; vl = o.v; }
      // roundabout: give way on entry to cars already circulating towards my entry point
      if (c.next >= 0 && ring(c.next >> 1) && !ring(c.d >> 1) && len - c.s < 16 && c.wait < 12) {
        const v = dTo(c.d);
        for (let i = inCnt[v]; i < inCnt[v + 1]; i++) {
          const r = inList[i]; if (r === c.d || !ring(r >> 1) || !carsOn[r]) continue;
          for (const o of carsOn[r]) if (eLen[r >> 1] - o.s < 18 && o.v > 0.5) { const g = len - c.s - 6 + CAR_GAP; if (g < gap) { gap = g; vl = 0; } }
        }
      }
      if (c.zone) {                                          // junction: cars crossing / turning into my path
        const cx = Math.floor(c.jx / CELL), cy = Math.floor(c.jy / CELL);
        for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
          for (let j = hHead[hcell(ix, iy)]; j >= 0; j = hNext[j]) {
            const o = cars[j]; if (o === c || (o.d === c.d && o.lane === c.lane) || o.d === c.next || o.next === c.d || o.d === c.prev || o.prev === c.d) continue;
            const dx = (o.jx - c.jx) * MPP, dy = (o.jy - c.jy) * MPP, along = dx * c.hx + dy * c.hy, side = Math.abs(dy * c.hx - dx * c.hy);
            if (Math.abs(along) < CAR_M - 0.5 && side < 1.6 && c.id < o.id) continue;   // already overlapping: lower id drives out
            if (!(along > -0.3 && along < 7 && side < 2.3)) continue;          // ahead, or alongside and too close to the side
            if (c.wait >= 6 && along > 3) continue;                            // waited long: may creep up, never into a car
            const alongO = -(dx * o.hx + dy * o.hy), sideO = Math.abs(dx * o.hy - dy * o.hx);
            if (alongO > -0.3 && alongO < 7 && sideO < 2.3 && c.id < o.id) continue;                // we see each other: lower id goes
            if (along + 1.6 < gap) { gap = along + 1.6; vl = 0; }
          }
        }
        for (let i = 0; i < Math.min(nb, MAXB); i++) {     // a bus body across the space I'm about to take: hold back
          const o = 4 * i, dx = (BUS[o] - c.jx) * MPP, dy = (BUS[o + 1] - c.jy) * MPP;
          const along = dx * c.hx + dy * c.hy, side = Math.abs(dy * c.hx - dx * c.hy), L = BUSL[i];
          if (side < 2.2 && along > 0 && along < L + 6 && !overBus(c, i)) { const g = along - L + CAR_M / 2; if (g < gap) { gap = g; vl = 0; } }
        }
      }
      if (nb && c.wait < 20) {                                // a bus in my path: follow it / queue behind it; pass on a free second lane
        const bg = busAhead(c, nb);
        if (bg < Infinity) {
          if (bg < 22 && perDir(c.d) === 2 && c.lane === Math.round(0.5 + c.off / LANE_W)) {
            const o = 1 - c.lane; if (roomAhead(c.d, c.s - 8, o) > 24 && !laneBus(c, o, nb)) { c.lane = o; c.offT = laneOffset(c.d, o); }
          }
          if (bg - 4.4 + CAR_GAP < gap) { gap = bg - 4.4 + CAR_GAP; vl = Math.min(c.v, 6); }
        }
      }
      // IDM-style driver: smooth acceleration towards the speed allowed (limit, curves ahead), comfortable braking behind
      // whatever is ahead; only a near-collision brakes harder
      const v0 = Math.max(0.5, Math.min(c.vmax, curveLimit(c)));
      const bump = gap - CAR_M;                                 // bumper-to-bumper metres
      const sStar = S0 + Math.max(0, c.v * c.hw + c.v * (c.v - vl) / (2 * Math.sqrt(c.acc * BRAKE)));
      let a = c.acc * (1 - (c.v / v0) ** 4 - (gap < Infinity ? (sStar / Math.max(0.1, bump)) ** 2 : 0));
      a = Math.max(-9, Math.min(c.acc, a));
      c.v = Math.max(0, c.v + a * dt);
      if (bump - c.v * dt < 0.8) c.v = Math.max(0, (bump - 0.8) / dt);   // never closer than 0.8 m bumper to bumper
      c.wait = c.v < 0.3 ? c.wait + dt : 0;
      c.s += c.v * dt;
      c.off += Math.max(-1.5 * dt, Math.min(1.5 * dt, c.offT - c.off));
      if (c.s >= len) {
        removeFrom(c.d, c);
        if (c.next < 0) { c.out = true; c.prev = -1; continue; }
        c.prev = c.d; enter(c, c.next, c.s - len);
      }
    }
  }
  // draw: cull by edge box, smoothed tangent (rounded corners) + lane offset; hidden stretches as an x-ray silhouette
  const vis = [], byY = (a, b) => a.y - b.y;
  function posOf(c) {                                     // camera px + screen heading of a car now -> c.x, c.y, c.gx, c.gy
    posAt(c, -1.6); const ax = SX, ay = SY; posAt(c, 1.6); const bx = SX, by = SY; posAt(c, 0);
    let gx = bx - ax, gy = (by - ay) / SQ; const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    c.x = SX - gy * c.off * PXM; c.y = SY + gx * c.off * PXM * SQ; c.gx = gx; c.gy = gy;
  }
  let lastK = 1, lastOx = 0, lastOy = 0, lastDpr = 1;
  function draw(ctx, k, ox, oy, u0, u1, v0, v1, dpr = 1) {
    frame++; vis.length = 0; lastK = k; lastOx = ox; lastOy = oy; lastDpr = dpr;
    for (const c of cars) {
      if (c.out || (eFlags[c.d >> 1] & 2)) continue;
      const b = 4 * (c.d >> 1);
      if (c !== followed && (eBox[b + 2] < u0 || eBox[b] > u1 || eBox[b + 3] < v0 || eBox[b + 1] > v1)) continue;
      posOf(c);
      if (c.x < u0 || c.x > u1 || c.y < v0 || c.y > v1) continue;
      c.pa = portalFade(c); c.a = cover(c); if (c.pa <= 0.02) continue;
      c.f = ((Math.round((45 - Math.atan2(-c.gy, c.gx) * DEG) / (360 / CAR.N)) % CAR.N) + CAR.N) % CAR.N; c.seen = frame;
      c.sx = (ox + c.x * k) / dpr; c.sy = (oy + c.y * k) / dpr; vis.push(c);
    }
    vis.sort(byY);
    const size = vehiclePx(CAR_M, k) * (CAR.VIEW / CAR_M) * 0.9, base = ctx.globalAlpha;   // shared scale with the buses; 0.9: toy cabin reads chunkier than a real car (user: "a bit smaller")
    for (const c of vis) {
      if (c.a <= 0.02) continue;
      ctx.globalAlpha = base * c.a * c.pa;
      ctx.drawImage(sheet, c.f * CAR.CELL, CAR.y0 + c.row * CAR.CELL, CAR.CELL, CAR.CELL, ox + c.x * k - size / 2, oy + c.y * k - size / 2, size, size);
    }
    // only the followed car keeps an outline over what hides it (so you don't lose it); other hidden cars just fade out:
    // pale outlines on every car under a tree or behind a wall read as cars driving underground
    if (followed && vis.includes(followed) && followed.a < 0.98) xray(ctx, followed, ox + followed.x * k - size / 2, oy + followed.y * k - size / 2, size, base * (1 - followed.a) * followed.pa);
    ctx.globalAlpha = base;
    if (tip && !tip.hidden) placeTip();
    return vis.length;
  }

  // ---------------- x-ray silhouettes: a flat light tint + thin light outline, built once from the sheet ----------------
  let xFill = null, xRing = null;
  const xTmp = document.createElement('canvas'); xTmp.width = xTmp.height = CAR.CELL; const xctx = xTmp.getContext('2d');
  function buildXray() {
    const w = sheet.width, h = sheet.height, mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    xFill = mk(); xRing = mk();
    const f = xFill.getContext('2d', { willReadFrequently: true }); f.drawImage(sheet, 0, 0);
    const id = f.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] > 150 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }   // body only, no soft shadow
    f.putImageData(id, 0, 0);
    const r = xRing.getContext('2d');
    for (let a = 0; a < 8; a++) r.drawImage(xFill, Math.round(Math.cos(a * Math.PI / 4) * 2), Math.round(Math.sin(a * Math.PI / 4) * 2));
    r.globalCompositeOperation = 'destination-out'; r.drawImage(xFill, 0, 0); r.globalCompositeOperation = 'source-over';
  }
  let accent = null;
  function xray(ctx, c, x0, y0, size, a) {
    if (a <= 0.02) return;
    if (!xFill) buildXray();
    const sx = c.f * CAR.CELL, sy = CAR.y0 + c.row * CAR.CELL, C = CAR.CELL;
    if (c !== followed) {
      ctx.globalAlpha = 0.25 * a; ctx.drawImage(xFill, sx, sy, C, C, x0, y0, size, size);
      ctx.globalAlpha = 0.8 * a; ctx.drawImage(xRing, sx, sy, C, C, x0, y0, size, size);
      return;
    }
    accent ??= getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a33d';
    for (const [src, alpha, glow] of [[xFill, 0.6, 0], [xRing, 1, 6]]) {    // the followed car: accent colour, stronger, glowing
      xctx.globalCompositeOperation = 'copy'; xctx.drawImage(src, sx, sy, C, C, 0, 0, C, C);
      xctx.globalCompositeOperation = 'source-in'; xctx.fillStyle = accent; xctx.fillRect(0, 0, C, C);
      ctx.globalAlpha = alpha * a; if (glow) { ctx.shadowColor = accent; ctx.shadowBlur = glow; }
      ctx.drawImage(xTmp, x0, y0, size, size); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    }
  }

  // ---------------- tap a car: a small card with "Follow" (shared follow camera in vehicles.js) ----------------
  const PAINT = { en: ['red', 'yellow', 'white', 'blue', 'mint', 'orange', 'navy', 'silver'],
                  sq: ['e kuqe', 'e verdhë', 'e bardhë', 'blu', 'jeshile', 'portokalli', 'blu e errët', 'gri'] };
  const lang = () => (document.documentElement.lang === 'sq' ? 'sq' : 'en');
  const label = c => (lang() === 'sq' ? `makina ${PAINT.sq[c.row]}` : `${PAINT.en[c.row]} car`);
  const coarse = matchMedia('(pointer: coarse)');
  function hit(x, y, touch) {                             // nearest drawn car within 20 px (22 = 44 px target on touch)
    const r = touch ? 22 : 20; let best = null, bd = r * r;
    for (const c of vis) {
      if (c.seen !== frame || (c.a < 0.5 && c !== followed)) continue;   // hidden cars can't be tapped, except the followed one
      const d = (c.sx - x) ** 2 + (c.sy - y) ** 2; if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function tipHTML(c) {
    const on = c === followed;
    // just one friendly action: Follow / Unfollow (no colour names)
    const icon = on ? '<path d="M6 6l12 12M18 6 6 18"/>' : '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="7.5"/>';
    return `<button type="button" class="bus-follow car-follow" aria-pressed="${on}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${icon}</svg>${on ? follow.t('unfollow') : follow.t('follow')}</button>`;
  }
  let tipW = 0, tipH = 0, tipKey = '';
  function placeTip() {
    const c = open; if (!c || c.out) { closeTip(true); return; }
    if (c.seen !== frame) { tip.style.visibility = 'hidden'; return; }
    tip.style.visibility = '';
    const key = (c === followed) + lang(); if (key !== tipKey) { tipKey = key; tip.innerHTML = tipHTML(c); tipW = tip.offsetWidth; tipH = tip.offsetHeight; }
    const W = viewer.container.clientWidth, sz = vehiclePx(CAR_M, lastK) / lastDpr;
    const x = Math.min(W - tipW - 8, Math.max(8, c.sx - tipW / 2));
    let y = c.sy - sz * 0.6 - tipH - 4; if (y < 8) y = c.sy + sz * 0.6 + 4;
    tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  }
  function openTip(c) {
    if (!tip) {
      tip = document.createElement('div'); tip.className = 'bus-tip car-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
      viewer.element.append(tip);
      tip.addEventListener('click', e => {
        if (!e.target.closest('.bus-follow') || !open) return;
        if (open === followed) { follow.stop(); endFollow(); tipKey = ''; placeTip(); }
        else { startFollow(open); open = null; tip.hidden = true; }      // following: the top chip (Following a car · Stop) is the one control
      });
    }
    open = c; tipKey = ''; tip.hidden = false; redraw();
  }
  function closeTip(force) { if (!tip || (!force && open && open === followed)) return; open = null; tip.hidden = true; }
  function startFollow(c) {
    followed = c; open = c;
    if (c.next < 0 && dOK(c.d ^ 1)) c.next = c.d ^ 1;
    follow.start({ label: follow.t('aCar'), getPos: () => {
      if (followed !== c || c.out) { if (followed === c) endFollow(); return null; }
      posOf(c); return [c.x - origin[0], c.y - origin[1]];                     // camera px -> image px
    } });
  }
  function endFollow() { const was = followed; followed = null; tipKey = ''; if (was && open === was && was.a < 0.5) closeTip(true); }
  const chip = document.getElementById('followChip');
  if (chip) new MutationObserver(() => { if (chip.hidden && followed) endFollow(); }).observe(chip, { attributes: true, attributeFilter: ['hidden'] });
  viewer.addHandler('canvas-click', e => {
    if (!e.quick || !enabled) return;
    const c = hit(e.position.x, e.position.y, e.pointerType === 'touch' || coarse.matches);
    if (c) { e.preventDefaultAction = true; if (c !== followed) openTip(c); } else if (open) closeTip();   // the followed car has no pill (the top chip stops it)
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeTip(true); });
  let enabled = true;
  function setEnabled(v) { enabled = v; if (!v) { carsNow.length = 0; if (followed) { follow.stop(); endFollow(); } closeTip(true); } }

  // debug overlay: the graph (red) and hidden stretches (green)
  function debug(ctx, k, ox, oy, u0, u1, v0, v1) {
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff2d55'; ctx.beginPath();
    for (let e = 0; e < E; e++) {
      const b = 4 * e; if (eBox[b + 2] < u0 || eBox[b] > u1 || eBox[b + 3] < v0 || eBox[b + 1] > v1) continue;
      for (let j = eStart[e]; j < eStart[e] + eCnt[e]; j++) (j === eStart[e] ? ctx.moveTo : ctx.lineTo).call(ctx, ox + PU[j] * k, oy + PV[j] * k);
    }
    ctx.stroke(); ctx.strokeStyle = '#0f0'; ctx.lineWidth = 3; ctx.beginPath();
    for (let d = 0; d < 2 * E; d++) for (let i = hOff[d]; i < hOff[d + 1]; i += 2) {
      const b = 4 * (d >> 1); if (eBox[b + 2] < u0 || eBox[b] > u1 || eBox[b + 3] < v0 || eBox[b + 1] > v1) continue;
      for (let s = HID[i]; s <= HID[i + 1]; s += 1) { pointAt(d & ~1, s); (s === HID[i] ? ctx.moveTo : ctx.lineTo).call(ctx, ox + SX * k + (d & 1 ? -3 : 3), oy + SY * k); }
    }
    ctx.stroke();
  }
  function _dbg(c) { const d = c.d; let reach = 0, ok = 0, fails = []; for (const t of exits) { const T = routeTo(t).dist[d]; if (T < Infinity) { reach++; if (routeOK(c, d, t)) ok++; else fails.push(t); } }
    const fin = exits.slice(0, 6).map(t => { const R = routeTo(t); let n = 0; for (const x of R.dist) if (x < Infinity) n++; return [t, n, inCnt[t + 1] - inCnt[t]]; });
    return { fin, exits: exits.length, reach, ok, fails: fails.slice(0, 5), d, from: dFrom(d), to: dTo(d), hist: [...c.hn] }; }
  return { _dbg, cars, step, draw, debug, setEnabled, get followed() { return followed; }, startFollow, openTip, hit };
}
