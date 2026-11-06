// Dajti Ekspres: the gondola from the eastern edge of Tirana up Mount Dajti. The cable is too thin for the 3D model, so
// the painting has the stations but no line; this layer draws the two cables on their pylons and red cabins gliding
// up and down at the real speed. Data: life/cablecar.json (post/cablecar_bake.py, camera px from the OSM line + DEM).
// Drawn on one canvas under the overlays, only while the line is on screen; clipped to the painting like the buses.
import { clipToPainting } from './vehicles.js';
import { GEO } from './geo.js';

const PXM = 1 / GEO.camera.mpp, UP = Math.SQRT1_2 * PXM;     // camera px per metre on the ground / per metre of height
const CABIN_W = 2.4, CABIN_H = 2.2, HANGER = 1.6;            // metres

export async function initCableCar({ viewer, item, origin, base = 'life/' }) {
  const d = await (await fetch(base + 'cablecar.json')).json();
  const cv = document.createElement('canvas'); cv.className = 'cable-layer'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  viewer.canvas.insertBefore(cv, viewer.drawer.canvas?.nextSibling || null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let dpr = 1, W = 0, H = 0, raf = 0;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = viewer.container.clientWidth; H = viewer.container.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  // bounding box of everything drawn (camera px), padded for the cabins and pylons
  const all = [d.up, d.down].flatMap(c => c.u.map((u, i) => [u, c.v[i]])).concat(d.pylons.map(p => [p[2], p[3]]));
  const bx0 = Math.min(...all.map(p => p[0])) - 60, bx1 = Math.max(...all.map(p => p[0])) + 60;
  const by0 = Math.min(...all.map(p => p[1])) - 60, by1 = Math.max(...all.map(p => p[1])) + 60;
  const STEP = d.up.s[1] - d.up.s[0], L = d.length_m;
  const pathOf = c => { const p = new Path2D(); c.u.forEach((u, i) => (i ? p.lineTo(u, c.v[i]) : p.moveTo(u, c.v[i]))); return p; };
  const cables = [pathOf(d.up), pathOf(d.down)];
  const at = (c, s) => { const f = Math.max(0, Math.min(c.u.length - 1.001, s / STEP)), i = Math.floor(f), t = f - i;
    return [c.u[i] + (c.u[i + 1] - c.u[i]) * t, c.v[i] + (c.v[i + 1] - c.v[i]) * t]; };
  const P0 = new OpenSeadragon.Point(0, 0), P1 = new OpenSeadragon.Point(1000, 0);
  let onScreen = false, dirty = false, lastT = 0;

  function draw() {
    const it = item(); if (!it) return;
    if (cv.width !== Math.round(viewer.container.clientWidth * Math.min(2, devicePixelRatio || 1))) resize();
    const p0 = it.imageToViewerElementCoordinates(P0), p1 = it.imageToViewerElementCoordinates(P1);
    const k = (p1.x - p0.x) / 1000, ox = p0.x - origin[0] * k, oy = p0.y - origin[1] * k;   // camera px -> css px
    onScreen = ox + bx1 * k > 0 && ox + bx0 * k < W && oy + by1 * k > 0 && oy + by0 * k < H;
    if (!onScreen && !dirty) return;                          // nothing drawn last time either: skip even the clear
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); dirty = false;
    if (!onScreen) return;
    dirty = true; lastT = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save(); clipToPainting(ctx, k, ox, oy);
    const m = k * PXM;                                        // css px per metre
    // pylons: a slim grey mast from the ground to the cable
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(70, 72, 78, 0.85)'; ctx.lineWidth = Math.max(1, 1.4 * m);
    ctx.beginPath();
    for (const [ut, vt, uf, vf] of d.pylons) { ctx.moveTo(ox + uf * k, oy + vf * k); ctx.lineTo(ox + ut * k, oy + vt * k); }
    ctx.stroke();
    // cables
    ctx.save(); ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    const lw = Math.max(1.1, 0.45 * m);                       // a dark core on a faint light halo: reads on forest and on sky
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = (lw + 1.6) / k; for (const p of cables) ctx.stroke(p);
    ctx.strokeStyle = 'rgba(28, 28, 34, 0.85)'; ctx.lineWidth = lw / k; for (const p of cables) ctx.stroke(p);
    ctx.restore();
    // cabins: every spacing_m on both cables, moving at speed_ms (up on one, down on the other). All cabins go into one
    // path (bodies), one path (hangers) and one path (windows): three draw calls instead of ~400 per frame.
    const cw = Math.max(2.2, CABIN_W * m), ch = Math.max(2, CABIN_H * m), hang = HANGER * UP * k, t = reduced.matches ? 0 : Date.now() / 1000;
    const n = Math.floor(L / d.spacing_m), off = (t * d.speed_ms) % d.spacing_m, r = Math.min(cw, ch) * 0.25;
    const bodies = new Path2D(), hangers = new Path2D(), wins = cw > 6 ? new Path2D() : null;
    for (const [c, dir] of [[d.up, 1], [d.down, -1]]) {
      for (let i = 0; i <= n + 1; i++) {
        const q = i * d.spacing_m + off, s = dir > 0 ? q : L - q - d.spacing_m / 2;   // metres from the lower station
        if (s < 8 || s > L - 8) continue;                                       // inside a station
        const [u, v] = at(c, s), x = ox + u * k, y = oy + v * k;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 40) continue;
        if (hang > 1.5) { hangers.moveTo(x, y); hangers.lineTo(x, y + hang); }
        const cy = y + Math.max(hang, 1);
        if (cw > 4) bodies.roundRect(x - cw / 2, cy, cw, ch, r); else bodies.rect(x - cw / 2, cy, cw, ch);
        if (wins) wins.rect(x - cw * 0.32, cy + ch * 0.2, cw * 0.64, ch * 0.32);
      }
    }
    ctx.strokeStyle = 'rgba(30, 30, 34, 0.75)'; ctx.lineWidth = Math.max(0.6, 0.25 * m); ctx.stroke(hangers);
    ctx.fillStyle = 'rgb(214, 40, 40)'; ctx.fill(bodies);
    if (wins) { ctx.fillStyle = 'rgba(200, 225, 240, 0.85)'; ctx.fill(wins); }
    ctx.restore();
  }
  // 30 fps is plenty for gondolas; while the map animates, OSD's own tick redraws (the loop doesn't draw twice)
  let animating = false;
  function loop() { raf = 0; if (document.hidden) return;
    if (!animating && performance.now() - lastT > 32) draw();
    if (onScreen && !reduced.matches) raf = requestAnimationFrame(loop); }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  viewer.addHandler('animation-start', () => { animating = true; });
  viewer.addHandler('animation', () => { draw(); if (onScreen) kick(); });
  viewer.addHandler('animation-finish', () => { animating = false; });
  viewer.addHandler('animation-finish', kick);
  viewer.addHandler('open', () => { resize(); kick(); });
  viewer.addHandler('resize', () => { resize(); draw(); });
  document.addEventListener('visibilitychange', kick);
  resize(); kick();
}
