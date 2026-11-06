// Live counter (like Isometric Istanbul's): "● 12 here now", tap to see total visits. Backed by /api/presence (a
// Durable Object in deploy/planes-worker.js). The tab's random per-session id (analytics.js, gone when the tab closes) is
// sent so the server can count live tabs; with Do Not Track / GPC nothing is recorded, the counts are only read.
import { enabled, sessionId } from './analytics.js';

export function initPresence({ el, t, lang }) {
  let mode = 'live', live = null, total = null, first = true;
  try { if (localStorage.getItem('tt-presence') === 'total') mode = 'total'; } catch {}
  const fmt = n => n == null ? '…' : new Intl.NumberFormat(lang() === 'sq' ? 'sq-AL' : 'en-US').format(n);
  const render = () => {
    const n = mode === 'live' ? live : total;
    el.innerHTML = `<span class="presence-dot" aria-hidden="true"></span><span><b>${fmt(n)}</b> ${mode === 'live' ? t('hereNow') : t('visits')}</span>`;
    el.setAttribute('aria-pressed', String(mode === 'total')); el.hidden = live == null && total == null;
  };
  el.addEventListener('click', () => { mode = mode === 'live' ? 'total' : 'live'; try { localStorage.setItem('tt-presence', mode); } catch {} render(); });
  const ping = async (bye = false) => {
    const q = new URLSearchParams();
    if (enabled && sessionId()) { q.set('sid', sessionId()); if (first) q.set('new', newVisit() ? '1' : '0'); if (bye) q.set('bye', '1'); }
    if (bye) { if (q.has('sid')) navigator.sendBeacon?.('/api/presence?' + q); return; }
    try { const r = await (await fetch('/api/presence?' + q, { cache: 'no-store' })).json(); live = Math.max(1, r.live ?? 1); /* you are here, even when not counted (DNT/GPC) */ total = r.total; first = false; render(); } catch {}
  };
  // a visit is counted once per tab session
  const newVisit = () => { try { if (sessionStorage.getItem('tt-counted')) return false; sessionStorage.setItem('tt-counted', '1'); return true; } catch { return true; } };
  ping(); setInterval(() => { if (!document.hidden) ping(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  addEventListener('pagehide', () => ping(true));
  return { render };
}
