// Tilt-shift (miniature) for Tiny Tirana: a very light blur at the top and bottom of the map, the middle stays sharp.
// Two bands of backdrop-filter blur with gradient masks, placed inside the OSD canvas just under the overlays, so the
// painting and the canvas layers (birds, cars, buses) are blurred while markers, planes and the UI chrome stay sharp.
// Slightly stronger when zoomed out, where the miniature look reads best. On by default; ?ts=off starts it off.

const KEY = 'tt-tiltshift';
const TXT = { sq: 'Efekti miniaturë', en: 'Tilt-shift (miniature)' };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function initTiltShift({ viewer, item, button }) {
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch {}
  if (new URLSearchParams(location.search).get('ts') === 'off') on = false;

  const el = document.createElement('div'); el.className = 'tilt'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="ts top soft"></i><i class="ts top hard"></i><i class="ts bot soft"></i><i class="ts bot hard"></i>';
  if (viewer.overlaysContainer) viewer.overlaysContainer.before(el); else viewer.canvas.append(el);

  let px = -1;
  function forZoom() {
    const it = item(); if (!it) return;
    const z = it.viewportToImageZoom(viewer.viewport.getZoom(true));
    const v = Math.round((2.2 - 1.0 * smooth(0.15, 0.75, z)) * 10) / 10;       // 2.2 px far out -> 1.2 px close in
    if (v !== px) { px = v; el.style.setProperty('--ts', `${v}px`); }
  }
  viewer.addHandler('update-viewport', forZoom);

  const label = () => { if (button) button.setAttribute('aria-label', TXT[document.documentElement.lang === 'sq' ? 'sq' : 'en']); };
  new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  function setOn(v, remember = false) {
    on = v; el.hidden = !on; button?.setAttribute('aria-pressed', String(on));
    if (remember) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {} }
  }
  if (button) { button.addEventListener('click', () => setOn(!on, true)); button.hidden = false; }
  label(); forZoom(); setOn(on);
  return { setOn, get on() { return on; } };
}
