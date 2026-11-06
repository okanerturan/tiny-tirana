// Cloudflare Worker: GET /api/planes -> live aircraft near Tirana, normalised. Same contract as viewer/dev_server.py.
// POST /api/e -> anonymous usage events from viewer/app/analytics.js into Workers Analytics Engine (binding EVENTS, see
// deploy/README.md). No cookies, no IPs stored: only the event name, up to 8 small properties, language, country.
// Server-cheap: responses are cached at the edge for 5 s, so all visitors share one upstream request per 5 s per colo.
import { LANDMARKS } from '../viewer/app/landmarks.js';
const CENTER = [41.36, 19.76], RADIUS_NM = 40, TTL = 5;
const UPSTREAMS = [
  ['adsb.lol', `https://api.adsb.lol/v2/lat/${CENTER[0]}/lon/${CENTER[1]}/dist/${RADIUS_NM}`, 'ac'],
  ['adsb.fi', `https://opendata.adsb.fi/api/v2/lat/${CENTER[0]}/lon/${CENTER[1]}/dist/${RADIUS_NM}`, 'aircraft'],
];

function normalise(rows, source) {
  const planes = [];
  for (const a of rows || []) {
    if (a.lat == null || a.lon == null) continue;
    const ground = a.alt_baro === 'ground';
    planes.push({ hex: a.hex, flight: (a.flight || '').trim(), reg: a.r || '', type: a.t || '', lat: a.lat, lon: a.lon,
      alt_ft: ground ? 0 : (a.alt_geom ?? a.alt_baro ?? 0), ground, gs_kt: a.gs || 0, track: a.track ?? a.true_heading ?? 0,
      vs_fpm: a.baro_rate ?? a.geom_rate ?? 0, seen: a.seen_pos ?? a.seen ?? 0 });
  }
  return { now: Date.now() / 1000, source, planes };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/e') return events(request, env);
    if ((url.pathname === '/app/' || url.pathname === '/app/index.html') && url.searchParams.has('lm')) return landmarkPage(request, env, url);
    if (url.pathname !== '/api/planes') return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    const cache = caches.default, key = new Request(url.origin + '/api/planes');
    const hit = await cache.match(key);
    if (hit) return hit;
    let body = null, last = '';
    for (const [name, upstream, field] of UPSTREAMS) {
      try {
        const r = await fetch(upstream, { headers: { 'User-Agent': 'tiny-tirana/1.0 (personal map)' }, cf: { cacheTtl: TTL } });
        if (!r.ok) throw new Error(r.status);
        body = JSON.stringify(normalise((await r.json())[field], name)); break;
      } catch (e) { last = `${name}: ${e}`; }
    }
    if (!body) body = JSON.stringify({ now: Date.now() / 1000, source: null, planes: [], error: last });
    const res = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL - 1}, s-maxage=${TTL}` } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};

// ---------- anonymous usage events ----------
const ALLOWED = new Set(['view', 'look', 'landmark', 'tab', 'toggle', 'search', 'share', 'follow', 'line', 'plane', 'card', 'time', 'perf', 'error', 'strip']);
async function events(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 16384) return new Response(null, { status: 413 });
  let data; try { data = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const country = request.cf?.country || '', sid = String(data.sid || '').slice(0, 12), lang = String(data.lang || '').slice(0, 4);
  for (const ev of (Array.isArray(data.ev) ? data.ev : []).slice(0, 50)) {
    if (!ALLOWED.has(ev.e)) continue;
    const p = Object.entries(ev.p || {}).slice(0, 8);
    env.EVENTS?.writeDataPoint({
      indexes: [ev.e],
      blobs: [sid, lang, country, ...p.map(([k, v]) => `${String(k).slice(0, 20)}=${String(v).slice(0, 40)}`)],
      doubles: [Number(ev.t) || 0],
    });
  }
  return new Response(null, { status: 204 });
}

// ---------- landmark links: /app/?lm=pyramid gets that landmark's title, text and picture in link previews ----------
const esc = x => String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
async function landmarkPage(request, env, url) {
  const res = await env.ASSETS.fetch(new Request(new URL('/app/', url), request));
  const p = LANDMARKS.find(x => x.id === url.searchParams.get('lm'));
  if (!p || !res.ok) return res;
  const lang = url.searchParams.get('lang') === 'sq' ? 'sq' : 'en';
  const title = `${p.name[lang]} · Tiny Tirana`, text = p.text[lang];
  const desc = text.length > 220 ? text.slice(0, text.lastIndexOf(' ', 217)) + '…' : text;
  const img = `${url.origin}/app/og/lm/${p.id}.jpg`, page = `${url.origin}/app/?lm=${p.id}${lang === 'sq' ? '&lang=sq' : ''}`;
  const set = v => ({ element(e) { e.setAttribute('content', v); } });
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', set(desc))
    .on('meta[property="og:title"], meta[name="twitter:title"]', set(title))
    .on('meta[property="og:image"], meta[name="twitter:image"]', set(img))
    .on('meta[property="og:image:alt"], meta[name="twitter:image:alt"]', set(`${p.name[lang]} on the Tiny Tirana map`))
    .on('meta[property="og:url"]', set(page))
    .on('meta[property="og:type"]', set('article'))
    .on('link[rel="canonical"]', { element(e) { e.setAttribute('href', page); } })
    .on('html', { element(e) { e.setAttribute('lang', lang); } })
    .transform(res);
}
