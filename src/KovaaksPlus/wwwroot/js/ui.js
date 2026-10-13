// Small DOM toolkit + shared formatting helpers.

// Let replaceChildren() skip null/false like h() does, so views can pass conditional children.
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...nodes) {
  return nativeReplaceChildren.apply(this, nodes.filter((n) => n != null && n !== false));
};

export function h(tag, props, ...children) {
  const el = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'line' || tag === 'g'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('--')) el.style.setProperty(k, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------- icons (24px stroke icons) ----------------
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  library: 'M4 4h6v16H4zM14 4l6 1.5-3.5 14.5-6-1.5z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M7 4.5v15l13-7.5z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  chevron: 'M6 9l6 6 6-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  image: 'M4 5h16v14H4zM4 15l4-4 5 5M14 14l2-2 4 4M15.5 9.5h.01',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V8M7 13l5-5 5 5M5 4h14',
  folder: 'M3 6h6l2 2h10v11H3z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  pause: 'M8 5v14M16 5v14',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 1v4M12 19v4M1 12h4M19 12h4',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  fire: 'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-3 5-3 8 0 4 3 7 8 7z',
  camera: 'M4 7h4l2-3h4l2 3h4v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.5 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  pin: 'M12 17v5M5 17h14l-2-4V5h1V3H6v2h1v8z',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  medal: 'M8 2h8l-2 6h-4zM12 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14v4M10 16h4',
  // Extra shapes for tag icons.
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  dot: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  square: 'M5 5h14v14H5z',
  triangle: 'M12 4 21 20H3z',
  diamond: 'M12 3l9 9-9 9-9-9z',
  hexagon: 'M7 3h10l5 9-5 9H7l-5-9z',
  wave: 'M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-3 5-2',
  zigzag: 'M3 17l4-8 4 8 4-8 4 8 2-4',
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  crosshair: 'M12 2v6M12 16v6M2 12h6M16 12h6M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  heart: 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  mouse: 'M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6zM12 7v4',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7S5 17 4 14l-1.5-3a1.5 1.5 0 0 1 2.6-1.4L8 13',
  gauge: 'M12 14l4-4M3.5 17a9 9 0 1 1 17 0',
  snowflake: 'M12 2v20M4 6l16 12M20 6 4 18',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};
export const ICON_NAMES = Object.keys(ICONS);

export function icon(name, cls) {
  const svg = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ic' + (cls ? ' ' + cls : '') });
  svg.append(h('path', { d: ICONS[name] || ICONS.target }));
  if (name === 'play' || name === 'star') svg.setAttribute('fill', 'currentColor');
  return svg;
}

// ---------------- formatting ----------------
export function fmtScore(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export const fmtPct = (v, d = 1) => (v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%');
export function fmtDuration(sec) {
  if (!sec) return '0m';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: dt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export function fmtDateTime(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function timeAgo(d) {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + 'mo ago';
  return Math.floor(s / (86400 * 365)) + 'y ago';
}
export function isToday(d) {
  if (!d) return false;
  const a = new Date(d), b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** CSS classes for a run row: PBs get a gold gradient, runs from earlier days are dimmed. */
export const runRowClass = (r) => [r.pb ? 'run-pb' : '', isToday(r.date) ? 'run-today' : 'run-old'].filter(Boolean).join(' ');

export const fmtSens = (r) => (r && r.sens ? `${+r.sens.toFixed(2)} ${r.sensScale || ''}`.trim() : '—');

// Media values are paths relative to the media folder ("tags/Static Clicking/thumbnail-1a2b3c.png").
export const mediaUrl = (name) => (name ? `https://media.kplus/${name.split('/').map(encodeURIComponent).join('/')}` : null);

/**
 * Makes an element accept dropped image/video files. onFile(file) is called with the first matching file.
 * accept: 'image' | 'media' (image or video).
 */
export function dropZone(el, onFile, accept = 'image') {
  const ok = (f) => f && (/^image\//.test(f.type) || (accept === 'media' && /^video\/(mp4|webm)/.test(f.type)));
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); el.classList.add('drop-hint'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hint'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-hint');
    const f = [...(e.dataTransfer?.files || [])].find(ok);
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(f);
  });
  return el;
}

/** Saves a dropped/pasted file into the media folder. owner: "scenario:<name>" | "tag:<name>" | "preset:<name>". */
export async function saveMediaFile(file, owner, target) {
  if (file.size > 60 * 1024 * 1024) throw new Error('That file is too large (60 MB max)');
  const { call } = await import('./rpc.js');
  return call('media.saveDataUrl', { dataUrl: await fileToDataUrl(file), owner, target });
}
export const isVideo = (name) => /\.(mp4|webm)$/i.test(name || '');

export function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 65% 52%)`;
}

// Benchmark prefixes and season/difficulty suffixes don't identify a scenario ("VT", "S5", "Novice"…).
const NOISE = /^(vt|vts|ra|cb|ww|kvks|s\d+|\d+%?|novice|intermediate|advanced|easy|medium|hard|elite|master|beginner|the|and|of|-)$/i;

/** The most distinctive word of a scenario name, shown on generated thumbnails ("VT DotTS Novice S5" → "DotTS"). */
export function keyWord(name) {
  const words = name.replace(/[()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
  const w = words.find((x) => !NOISE.test(x)) || words[0] || '?';
  return w.length > 10 ? w.slice(0, 9) + '…' : w;
}

export function initials(name) {
  const words = name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((x) => x && !NOISE.test(x));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Thumbnail element: user image/video if set, else a generated gradient tile. */
export function thumb(name, media, tagColor, extraClass = '') {
  if (media) {
    const url = mediaUrl(media);
    return h('div', { class: 'thumb ' + extraClass },
      isVideo(media) ? h('video', { src: url, muted: true, loop: true, autoplay: true, playsinline: true }) : h('img', { src: url, loading: 'lazy', alt: '' }));
  }
  const c1 = tagColor || hashColor(name);
  const c2 = hashColor(name + '#');
  const word = keyWord(name);
  const size = word.length <= 4 ? 1 : word.length <= 6 ? 0.85 : word.length <= 8 ? 0.72 : 0.6;
  const el = h('div', { class: 'thumb gen ' + extraClass, style: { background: `linear-gradient(135deg, ${c1}, color-mix(in srgb, ${c2} 70%, #0b0d12))` } },
    reticle(), h('div', { class: 'initials', style: { '--k': size } }, word));
  return el;
}

function reticle() {
  const s = h('svg', { viewBox: '0 0 100 100', class: 'reticle', fill: 'none', stroke: 'currentColor', 'stroke-width': '4' });
  s.append(h('circle', { cx: 50, cy: 50, r: 30 }), h('circle', { cx: 50, cy: 50, r: 4, fill: 'currentColor' }),
    h('line', { x1: 50, y1: 4, x2: 50, y2: 30 }), h('line', { x1: 50, y1: 70, x2: 50, y2: 96 }),
    h('line', { x1: 4, y1: 50, x2: 30, y2: 50 }), h('line', { x1: 70, y1: 50, x2: 96, y2: 50 }));
  return s;
}

// ---------------- toasts / modals ----------------
export function toast(text, kind = '') {
  const el = h('div', { class: 'toast ' + kind }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3200);
}

export function modal({ title, body, actions = [], wide = false, onClose, panel = false }) {
  const root = document.getElementById('modal-root');
  const close = (v) => { backdrop.remove(); document.removeEventListener('keydown', esc); onClose && onClose(v); };
  const esc = (e) => { if (e.key === 'Escape') close(null); };
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(h('button', {
      class: 'btn ' + (a.kind || ''),
      onclick: async () => { if (a.onClick) { const keep = await a.onClick(); if (keep === false) return; } close(a.value); },
    }, a.label));
  }
  const backdrop = h('div', { class: 'modal-backdrop' + (panel ? ' panel' : ''), onmousedown: (e) => { if (e.target === backdrop) close(null); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      title && h('div', { class: 'modal-head' }, title),
      h('div', { class: 'modal-body' }, body),
      actions.length ? foot : null));
  root.append(backdrop);
  document.addEventListener('keydown', esc);
  const first = backdrop.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { close };
}

export function confirmBox(title, text, okLabel = 'Confirm', kind = 'primary') {
  return new Promise((resolve) => {
    modal({
      title, body: h('div', null, text),
      actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: okLabel, kind, value: true }],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function promptBox(title, label, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value });
    let result = null;
    const m = modal({
      title, body: h('label', { class: 'field' }, label, input),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: okLabel, kind: 'primary', onClick: () => { result = input.value; } }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = input.value; m.close(); } });
  });
}

export function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'toggle' }, input, h('span'));
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  for (const o of options) {
    const b = h('button', { class: o.value === value ? 'on' : '', title: o.title || '' }, o.icon ? icon(o.icon) : null, o.label || '');
    b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(o.value); };
    el.append(b);
  }
  return el;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** A tag's sidebar marker: its custom icon (built-in or image), otherwise the colour dot. Never its thumbnail. */
export function tagIcon(tag) {
  if (tag.icon && tag.icon.startsWith('ic:')) return h('span', { class: 'tag-ico', style: { color: tag.color } }, icon(tag.icon.slice(3)));
  if (tag.icon) return h('span', { class: 'tag-ico' }, h('img', { src: mediaUrl(tag.icon), alt: '' }));
  return h('span', { class: 'sw', '--c': tag.color });
}

export function tagChip(tag, opts = {}) {
  return h('span', { class: 'chip ' + (opts.sm ? 'sm ' : '') + (opts.cls || ''), '--c': tag.color, onclick: opts.onClick, title: opts.title },
    tag.name, opts.onRemove ? h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); opts.onRemove(); } }, '×') : null);
}

// ---------------- context menu ----------------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

/**
 * Right-click menu. items: [{label, icon, onClick, danger, disabled, hint}] or {sep:true} or {header:'text'}.
 * Pass the triggering MouseEvent for positioning.
 */
export function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', oncontextmenu: (ev) => ev.preventDefault() });
  for (const it of items.filter(Boolean)) {
    if (it.sep) { menu.append(h('div', { class: 'ctx-sep' })); continue; }
    if (it.header) { menu.append(h('div', { class: 'ctx-header' }, it.header)); continue; }
    menu.append(h('button', {
      class: 'ctx-item' + (it.danger ? ' danger' : ''), disabled: it.disabled,
      onclick: () => { closeMenu(); it.onClick && it.onClick(); },
    }, it.icon ? icon(it.icon, it.iconClass) : h('span', { class: 'ic' }), h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'ctx-hint' }, it.hint) : null));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
  openMenu = menu;
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);
document.addEventListener('scroll', closeMenu, true);

export function flag(cc) {
  if (!cc || cc.length !== 2) return h('span', { class: 'flag-blank' });
  return h('img', { class: 'flag', src: `https://flagcdn.com/w20/${cc.toLowerCase()}.png`, alt: cc.toUpperCase(), title: cc.toUpperCase(), loading: 'lazy' });
}

export function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'ok'), () => toast('Couldn\'t copy', 'error'));
}

/** Read an image File/Blob as a data URL (for paste/drag-drop thumbnails). */
export function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

// KovaaK's often reports every rank colour as #ffffff, so fall back to well-known benchmark rank colours.
const RANK_COLORS = {
  iron: '#9ca3af', bronze: '#d08a4c', silver: '#cbd5e1', gold: '#fbbf24', platinum: '#5eead4', diamond: '#60a5fa',
  jade: '#34d399', master: '#f472b6', grandmaster: '#f43f5e', nova: '#a78bfa', astra: '#e879f9', celestial: '#fde68a',
};
const RANK_PALETTE = ['#6b7280', '#9ca3af', '#d08a4c', '#cbd5e1', '#fbbf24', '#5eead4', '#60a5fa', '#34d399', '#f472b6', '#f43f5e', '#a78bfa', '#e879f9', '#fde68a'];

/** Rank icon <img> that removes itself when the image doesn't exist (evxl has no art for some ranks). */
export function rankImg(src, size = 20) {
  if (!src) return null;
  return h('img', { src, class: 'rank-img', style: { width: size + 'px', height: size + 'px' }, onerror: (e) => e.target.remove(), alt: '' });
}

export function rankColor(rank, index = 0) {
  if (rank && rank.color && !/^#?f{6}$/i.test(rank.color)) return rank.color;
  const key = (rank && rank.name || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, c] of Object.entries(RANK_COLORS)) if (key.startsWith(k)) return c;
  return RANK_PALETTE[Math.min(index, RANK_PALETTE.length - 1)];
}
