import { track } from './analytics.js';
import { GEO } from './geo.js';
// Shared rules for everything that drives on the map (buses.js, cars.js), so vehicles stay in proportion and see each other.
//
// Size: true metres at the current image zoom, with ONE floor in pixels-per-metre for all vehicles. When zoomed out,
// a bus and a car grow by the same factor, so a 12 m bus is always ~2.7x a 4.5 m car.
// Traffic: buses.js publishes where every visible bus is each frame (camera px, heading, length); cars.js treats a bus
// in its lane ahead like the car in front (slow down, queue behind it at stops, never pass through it).

// ---------------- where the painting is ----------------
// The painted city is an irregular shape inside its bounding box. app.js hands over the deepest level of the tile
// index (which 512 px tiles exist); vehicles and ground life are only drawn there, never over the empty dark corners.
let PM = null;   // { u0, v0, cell, cols, bits, path }
export function setPainted({ origin, cell, cols, bits }) {
  const path = new Path2D(), rows = Math.ceil(bits.length * 8 / cols), on = i => !!(bits[i >> 3] & (1 << (i & 7)));
  for (let r = 0; r < rows; r++) {                    // one rectangle per run of painted tiles in a row
    for (let c = 0; c < cols;) {
      if (!on(r * cols + c)) { c++; continue; }
      const c0 = c; while (c < cols && on(r * cols + c)) c++;
      path.rect(origin[0] + c0 * cell, origin[1] + r * cell, (c - c0) * cell, cell);
    }
  }
  PM = { u0: origin[0], v0: origin[1], cell, cols, bits, path };
}
/** Is camera px (u, v) on the painting? (true when no index is loaded) */
export function isPainted(u, v) {
  if (!PM) return true;
  const c = Math.floor((u - PM.u0) / PM.cell), r = Math.floor((v - PM.v0) / PM.cell);
  if (c < 0 || r < 0 || c >= PM.cols) return false;
  const i = r * PM.cols + c; return !!(PM.bits[i >> 3] & (1 << (i & 7)));
}
/** Clip ctx to the painting. (k, ox, oy) map camera px to the ctx's current pixel space: x = ox + u * k. Call inside save()/restore(). */
export function clipToPainting(ctx, k, ox, oy) {
  if (!PM) return;
  const m = ctx.getTransform(); ctx.transform(k, 0, 0, k, ox, oy); ctx.clip(PM.path); ctx.setTransform(m);
}

export const MPP = GEO.camera.mpp;        // metres per image px at image zoom 1
export const MIN_PX_PER_M = 1.6;          // floor when zoomed out: bus 12 m -> 19 px, car 4.3 m -> 7 px
export const MAX_PX_PER_M = 9.0;          // ceiling when zoomed in

/** On-screen length in px of a vehicle `metres` long at image zoom `k`. */
export function vehiclePx(metres, k) {
  const pxPerM = Math.min(MAX_PX_PER_M, Math.max(MIN_PX_PER_M, k / MPP));
  return metres * pxPerM;
}

/** Buses currently on the road: [{ u, v, hx, hy, len }] in CAMERA px (u, v), unit heading (hx, hy) in camera px,
 *  length in camera px. Written by buses.js every frame; read by cars.js. */
export const busesNow = [];

// ---------------- follow camera (shared by buses and cars) ----------------
// follow.start({ label, getPos }) : getPos() -> [imageX, imageY] of the vehicle now, or null when it has left the map.
// The view glides after it (critically damped, so it never overshoots). Dragging, pinching, zooming with the wheel,
// Esc, or the chip's Stop button ends it.
let F = null;
export const follow = {
  viewer: null, chip: null, t: s => s,
  init({ viewer, chip, t }) {
    this.viewer = viewer; this.chip = chip; this.t = t;
    const stop = () => this.stop();
    viewer.addHandler('canvas-drag', stop); viewer.addHandler('canvas-pinch', stop); viewer.addHandler('canvas-scroll', () => {});
    addEventListener('keydown', e => { if (e.key === 'Escape' && F) this.stop(); });
    chip.querySelector('button')?.addEventListener('click', stop);
  },
  start({ label, getPos }) {
    if (!this.viewer) return;
    F = { label, getPos, last: performance.now() }; track('follow', { what: label });
    this.chip.querySelector('.txt').textContent = `${this.t('following')} ${label}`;
    this.chip.hidden = false;
    requestAnimationFrame(step);
  },
  stop() { F = null; if (this.chip) this.chip.hidden = true; },
  get active() { return !!F; },
  isFollowing(label) { return !!F && F.label === label; },
};
function step(now) {
  if (!F) return;
  const v = follow.viewer, it = v.world.getItemAt(0), p = F.getPos();
  if (!it || !p) { follow.stop(); return; }
  const target = it.imageToViewportCoordinates(p[0], p[1]), c = v.viewport.getCenter(true);
  const dt = Math.min(0.05, (now - F.last) / 1000); F.last = now;
  const k = 1 - Math.exp(-dt * 6);                                   // ~0.3 s to close most of the gap
  v.viewport.panTo(new OpenSeadragon.Point(c.x + (target.x - c.x) * k, c.y + (target.y - c.y) * k), true);
  requestAnimationFrame(step);
}

/** Cars currently on the road: [{ u, v, hx, hy, len, v_mps }] in CAMERA px, written by cars.js every frame; read by buses.js
 *  so a bus behind a car slows and queues (timetable lag allowed, made up once the road clears). */
export const carsNow = [];
