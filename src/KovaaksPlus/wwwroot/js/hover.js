// Hover previews, so you don't have to open the side panel to see a scenario:
// - cards (grid view) play the scenario's preview over their own thumbnail;
// - list rows and table names show a small pop-up next to the cursor.
// Toggle: App Settings → Appearance → Preview on hover.
import { h, mediaUrl, isVideo, fmtScore } from './ui.js';
import { scenario as findScenario, displayName } from './state.js';
import { appearance } from './theme.js';
import { scenarioThumb, tagThumbs } from './thumbs.js';

const DELAY = 260;   // ms of hovering before anything appears, so sweeping the mouse across a list stays calm
const enabled = () => appearance().hoverPreview !== false;

function media(file, cls) {
  if (!isVideo(file)) return h('img', { class: cls, src: mediaUrl(file), alt: '' });
  const v = h('video', { class: cls, src: mediaUrl(file), loop: true, autoplay: true, playsinline: true });
  v.muted = true;
  return v;
}

/** Grid card: overlays the preview (image, GIF or clip) on the card's thumbnail. No preview → nothing happens. */
export function cardPreview(card, thumbEl, s) {
  if (!s || !s.preview) return;
  let timer = null, layer = null;
  card.addEventListener('mouseenter', () => {
    if (!enabled()) return;
    timer = setTimeout(() => {
      layer = media(s.preview, 'hover-preview');
      thumbEl.append(layer);
      requestAnimationFrame(() => layer && layer.classList.add('in'));
    }, DELAY);
  });
  card.addEventListener('mouseleave', () => { clearTimeout(timer); if (layer) layer.remove(); layer = null; });
}

// ---------------------------------------------------------------- floating pop-up (one at a time)
let pop = null, popTimer = null;
let mouse = { x: 0, y: 0 };

function hide() {
  clearTimeout(popTimer);
  if (pop) pop.remove();
  pop = null;
}
window.addEventListener('scroll', hide, true);
window.addEventListener('mousedown', hide, true);
window.addEventListener('hashchange', hide);

function show(el, name) {
  if (!el.isConnected || !el.matches(':hover')) return;
  const s = findScenario(name);
  if (!s) return;
  const file = s.preview || s.thumbnail;
  if (!file && !tagThumbs(s).length) return;   // only a generated tile: not worth a pop-up
  hide();
  pop = h('div', { class: 'hover-pop' },
    h('div', { class: 'hp-media' }, file ? media(file) : scenarioThumb(s)),
    h('div', { class: 'hp-body' },
      h('div', { class: 'hp-name' }, displayName(s)),
      h('div', { class: 'small muted' }, s.pb != null ? ['PB ', h('b', null, fmtScore(s.pb)), ' · '] : null, `${s.plays || 0} plays`, s.preview ? null : ' · no preview set')));
  document.body.append(pop);
  place(el);
  requestAnimationFrame(() => pop && pop.classList.add('in'));
}

function place(el) {
  if (!pop) return;
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth, hgt = pop.offsetHeight, m = 10;
  let x = mouse.x + 18;
  if (x + w > innerWidth - m) x = mouse.x - w - 18;
  let y = r.bottom + 6;
  if (y + hgt > innerHeight - m) y = r.top - hgt - 6;
  pop.style.left = Math.max(m, x) + 'px';
  pop.style.top = Math.max(m, y) + 'px';
}

/** List row / table cell: pop-up preview near the cursor. name: scenario name, or a function returning it. */
export function floatPreview(el, name) {
  el.addEventListener('mouseenter', (e) => {
    if (!enabled()) return;
    mouse = { x: e.clientX, y: e.clientY };
    clearTimeout(popTimer);
    popTimer = setTimeout(() => show(el, typeof name === 'function' ? name() : name), DELAY);
  });
  el.addEventListener('mousemove', (e) => { mouse = { x: e.clientX, y: e.clientY }; if (pop) place(el); });
  el.addEventListener('mouseleave', hide);
}

/** floatPreview that returns the element, for inline use inside h(...). */
export const previewed = (el, name) => { floatPreview(el, name); return el; };
