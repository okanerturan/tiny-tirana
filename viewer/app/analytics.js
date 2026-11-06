// Anonymous, cookieless usage statistics for Tiny Tirana.
//
// What is sent: event names with a few small properties (which landmark card, which layer toggled, whether a search
// found something, the map centre rounded to ~1 km every 30 s while the tab is visible), plus a random id that lives
// only in this tab's sessionStorage (gone when the tab closes) so one visit's events can be grouped.
// Also: seconds the map was visible, how long the first tile took and the frame rate, script errors (40 chars), the
// window width in 100 px steps, pixel ratio, touch or mouse, browser language.
// What is never sent: cookies, persistent ids, search text, precise positions, IP addresses (the server keeps the
// country only). Nothing at all is sent when the browser asks not to be tracked (Global Privacy Control or
// Do Not Track) or on localhost-style dev hosts unless ?analytics=dev.
//
// Transport: batched JSON to /api/e with navigator.sendBeacon (deploy/planes-worker.js writes it to Workers Analytics
// Engine; viewer/dev_server.py appends it to data/analytics_dev.jsonl for testing).

const ENDPOINT = '/api/e', FLUSH_MS = 15000, MAX_BATCH = 40;
const q = new URLSearchParams(location.search);
const optedOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
const devHost = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
export const enabled = !optedOut && (!devHost || q.get('analytics') === 'dev');

let sid = null;
try { sid = sessionStorage.getItem('tt-sid'); if (!sid) { sid = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('tt-sid', sid); } } catch { sid = 'nosession'; }
const queue = [];
const clean = v => typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
  : typeof v === 'boolean' ? v : v == null ? null : String(v).slice(0, 40);

/** track('landmark', { id: 'pyramid' }) — properties: strings (cut to 40 chars), numbers or booleans. */
export function track(name, props = {}) {
  if (!enabled) return;
  const p = {}; for (const [k, v] of Object.entries(props).slice(0, 8)) p[String(k).slice(0, 20)] = clean(v);
  queue.push({ e: String(name).slice(0, 24), p, t: Math.round(performance.now()) });
  if (queue.length >= MAX_BATCH) flush();
}
function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ sid, lang: document.documentElement.lang || '', ev: queue.splice(0, queue.length) });
  try { if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {}); } catch {}
}
if (enabled) {
  setInterval(flush, FLUSH_MS);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  const w = Math.min(screen.width, screen.height);
  let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
  if (ref === location.hostname) ref = '';
  track('view', { device: w < 600 ? 'phone' : w < 1000 ? 'tablet' : 'desktop', ref, src: q.get('utm_source') || '',
    vw: Math.round(innerWidth / 100) * 100, dpr: Math.round((devicePixelRatio || 1) * 2) / 2, touch: matchMedia('(pointer: coarse)').matches,
    blang: (navigator.language || '').slice(0, 2) });
  // time actually looking at the map (visible tab), sent each time the tab is hidden: the last one per visit is the total
  let visMs = 0, since = document.hidden ? null : performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (since != null) visMs += performance.now() - since; since = null; track('time', { secs: Math.round(visMs / 1000) }); flush(); }
    else since = performance.now();
  }, { capture: true });
  // script errors (message cut to 40 chars, file name only), at most 5 per visit
  let nErr = 0;
  const err = (msg, src, line) => { if (nErr++ < 5) track('error', { msg: String(msg || '').slice(0, 40), src: String(src || '').split('/').pop().slice(0, 30), line: line || 0 }); };
  addEventListener('error', e => err(e.message, e.filename, e.lineno));
  addEventListener('unhandledrejection', e => err(e.reason?.message || e.reason, '', 0));
}

/** Load speed and smoothness, once per visit: ms until the first map tile arrived, and frames per second a few
 *  seconds later (2 s sample, only if the tab is visible). Helps to see whether slow phones struggle. */
export function trackPerf(viewer) {
  if (!enabled) return;
  viewer.addOnceHandler('tile-loaded', () => track('perf', { first: Math.round(performance.now()) }));
  setTimeout(() => {
    if (document.hidden) return;
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else track('perf', { fps: Math.round(n / ((performance.now() - t0) / 1000)) }); };
    requestAnimationFrame(f);
  }, 8000);
}

/** Every 30 s while visible: the rounded map centre and zoom bucket (a coarse heat map of what people look at). */
export function trackLooking(getView) {
  if (!enabled) return;
  setInterval(() => {
    if (document.hidden) return;
    const v = getView(); if (!v) return;
    track('look', { lat: Math.round(v.lat * 100) / 100, lon: Math.round(v.lon * 100) / 100, z: v.z < 0.15 ? 'far' : v.z < 0.45 ? 'mid' : 'close' });
  }, 30000);
}
