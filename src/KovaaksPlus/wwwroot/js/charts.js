// Dependency-free SVG charts with hover tooltips.
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
let gid = 0;

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const shortNum = (v) => Math.abs(v) >= 10000 ? (v / 1000).toFixed(0) + 'k' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : (+v.toFixed(2)).toString();

/**
 * series: [{ points: [{x, y, tip?, pb?}], color, width, dashed, area, dots }]
 * opts: { height, yFormat, hLines: [{y, label, color}], highlight: {series, index}, xLabels: fn(x) }
 */
export function lineChart(container, series, opts = {}) {
  const height = opts.height || 220;
  const wrap = h('div', { class: 'chart', style: { height: height + 'px' } });
  container.append(wrap);
  const tip = h('div', { class: 'tip', style: { display: 'none' } });

  const draw = () => {
    const width = Math.max(200, wrap.clientWidth);
    wrap.replaceChildren();
    const pad = { l: 46, r: 14, t: 12, b: opts.xLabels ? 24 : 10 };
    const all = series.flatMap((sr) => sr.points);
    if (!all.length) { wrap.append(h('div', { class: 'empty', style: { padding: '30px' } }, opts.emptyText || 'No data yet')); return; }
    let ys = all.map((p) => p.y);
    (opts.hLines || []).forEach((l) => ys.push(l.y));
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (opts.yMin != null) ymin = Math.min(ymin, opts.yMin);
    const { lo, hi, ticks } = niceTicks(ymin, ymax, 4);
    const xs = all.map((p) => p.x);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const X = (x) => pad.l + (xmax === xmin ? (width - pad.l - pad.r) / 2 : (x - xmin) / (xmax - xmin) * (width - pad.l - pad.r));
    const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);

    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });
    const defs = s('defs');
    svg.append(defs);
    const axis = s('g', { class: 'axis' });
    for (const t of ticks) {
      axis.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t), class: 'gridline', 'stroke-dasharray': '2 4' }));
      const tx = s('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end' });
      tx.textContent = (opts.yTick || shortNum)(t);
      axis.append(tx);
    }
    if (opts.xLabels) {
      const n = Math.min(6, Math.floor((width - pad.l) / 90));
      for (let i = 0; i <= n; i++) {
        const xv = xmin + (xmax - xmin) * (i / n);
        const tx = s('text', { x: X(xv), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle' });
        tx.textContent = opts.xLabels(xv);
        axis.append(tx);
      }
    }
    svg.append(axis);

    series.forEach((sr) => {
      if (!sr.points.length) return;
      const pts = sr.points.map((p) => [X(p.x), Y(p.y)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (sr.area) {
        const id = 'g' + (++gid);
        const grad = s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.append(s('stop', { offset: '0%', 'stop-color': sr.color, 'stop-opacity': '.32' }), s('stop', { offset: '100%', 'stop-color': sr.color, 'stop-opacity': '0' }));
        defs.append(grad);
        svg.append(s('path', { d: d + ` L${pts[pts.length - 1][0]} ${Y(lo)} L${pts[0][0]} ${Y(lo)} Z`, fill: `url(#${id})` }));
      }
      svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 2, 'stroke-dasharray': sr.dashed ? '5 5' : '', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: sr.opacity || 1 }));
      if (sr.dots !== false && sr.points.length <= 120) {
        sr.points.forEach((p, i) => {
          if (p.pb) svg.append(s('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, fill: '#fbbf24', stroke: '#0b0d12', 'stroke-width': 1.5 }));
          else if (sr.dots) svg.append(s('circle', { cx: pts[i][0], cy: pts[i][1], r: 2.5, fill: sr.color }));
        });
      }
    });

    for (const l of opts.hLines || []) {
      svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(l.y), y2: Y(l.y), stroke: l.color || '#fbbf24', 'stroke-dasharray': '6 5', 'stroke-width': 1.2, opacity: .8 }));
      if (l.label) {
        const tx = s('text', { x: width - pad.r - 4, y: Y(l.y) - 5, 'text-anchor': 'end', fill: l.color || '#fbbf24', 'font-size': 11, 'font-weight': 600 });
        tx.textContent = l.label;
        svg.append(tx);
      }
    }

    if (opts.highlight) {
      const sr = series[opts.highlight.series || 0];
      const p = sr && sr.points[opts.highlight.index];
      if (p) {
        svg.append(s('circle', { cx: X(p.x), cy: Y(p.y), r: 9, fill: 'none', stroke: opts.highlight.color || '#fff', 'stroke-width': 2, opacity: .9 }));
        svg.append(s('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: opts.highlight.color || '#fff' }));
      }
    }

    const cursor = s('line', { y1: pad.t, y2: height - pad.b, stroke: '#ffffff', 'stroke-opacity': .18, display: 'none' });
    const cursorDot = s('circle', { r: 4.5, fill: '#fff', stroke: '#0b0d12', 'stroke-width': 2, display: 'none' });
    svg.append(cursor, cursorDot);
    wrap.append(svg, tip);

    const main = series[0];
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (width / rect.width);
      let best = null, bd = Infinity;
      main.points.forEach((p) => { const dx = Math.abs(X(p.x) - mx); if (dx < bd) { bd = dx; best = p; } });
      if (!best) return;
      const px = X(best.x), py = Y(best.y);
      cursor.setAttribute('x1', px); cursor.setAttribute('x2', px); cursor.setAttribute('display', '');
      cursorDot.setAttribute('cx', px); cursorDot.setAttribute('cy', py); cursorDot.setAttribute('display', '');
      tip.style.display = '';
      tip.style.left = (px / width * rect.width) + 'px';
      tip.style.top = (py / height * rect.height) + 'px';
      tip.innerHTML = best.tip || `<b>${(opts.yFormat || shortNum)(best.y)}</b>`;
      if (best.onClick) svg.style.cursor = 'pointer'; else svg.style.cursor = '';
      svg._hover = best;
    });
    svg.addEventListener('mouseleave', () => { cursor.setAttribute('display', 'none'); cursorDot.setAttribute('display', 'none'); tip.style.display = 'none'; });
    svg.addEventListener('click', () => { if (svg._hover && svg._hover.onClick) svg._hover.onClick(); });
  };

  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  draw();
  return wrap;
}

/** bars: [{label, value, tip, color}] */
export function barChart(container, bars, opts = {}) {
  const height = opts.height || 160;
  const wrap = h('div', { class: 'chart', style: { height: height + 'px' } });
  container.append(wrap);
  const tip = h('div', { class: 'tip', style: { display: 'none' } });
  const draw = () => {
    const width = Math.max(200, wrap.clientWidth);
    wrap.replaceChildren();
    const pad = { l: 36, r: 6, t: 8, b: opts.labels ? 22 : 6 };
    const max = Math.max(1, ...bars.map((b) => b.value));
    const { hi, ticks } = niceTicks(0, max, 3);
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });
    const axis = s('g', { class: 'axis' });
    const Y = (v) => pad.t + (1 - v / hi) * (height - pad.t - pad.b);
    for (const t of ticks) {
      axis.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t), class: 'gridline', 'stroke-dasharray': '2 4' }));
      const tx = s('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = shortNum(t); axis.append(tx);
    }
    svg.append(axis);
    const bw = (width - pad.l - pad.r) / bars.length;
    bars.forEach((b, i) => {
      const x = pad.l + i * bw + Math.max(1, bw * 0.18);
      const w = Math.max(2, bw * 0.64);
      const r = s('rect', { x, y: Y(b.value), width: w, height: Math.max(0, Y(0) - Y(b.value)), rx: Math.min(4, w / 2), fill: b.color || opts.color || 'var(--accent)', opacity: b.value ? .9 : .25 });
      r.addEventListener('mouseenter', () => {
        const rect = svg.getBoundingClientRect();
        tip.style.display = ''; tip.innerHTML = b.tip || `${b.label}: <b>${b.value}</b>`;
        tip.style.left = ((x + w / 2) / width * rect.width) + 'px'; tip.style.top = (Y(b.value) / height * rect.height) + 'px';
      });
      r.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      svg.append(r);
      if (opts.labels && (bars.length <= 14 || i % Math.ceil(bars.length / 10) === 0)) {
        const tx = s('text', { x: x + w / 2, y: height - 6, 'text-anchor': 'middle', class: 'axis' });
        tx.setAttribute('fill', 'var(--muted)'); tx.setAttribute('font-size', '10'); tx.textContent = b.label; svg.append(tx);
      }
    });
    wrap.append(svg, tip);
  };
  new ResizeObserver(draw).observe(wrap);
  draw();
  return wrap;
}

/** GitHub-style training calendar. daily: [{day:'yyyy-mm-dd', runs, seconds}] */
export function heatmap(container, daily, weeks = 53) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const max = Math.max(1, ...daily.map((d) => d.runs));
  const grid = h('div', { class: 'heatmap' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());
  const tip = h('div', { class: 'tip', style: { display: 'none', position: 'fixed' } });
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const v = byDay.get(local) || byDay.get(key);
    const runs = v ? v.runs : 0;
    const level = runs ? 0.25 + 0.75 * Math.sqrt(runs / max) : 0;
    const cell = h('i', { style: runs ? { background: `color-mix(in srgb, var(--accent) ${Math.round(level * 100)}%, var(--surface-2))` } : null });
    const label = new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    cell.addEventListener('mouseenter', (e) => {
      tip.style.display = ''; tip.innerHTML = `<b>${runs} run${runs === 1 ? '' : 's'}</b> · ${label}${v && v.pbs ? ` · ${v.pbs} PB` : ''}`;
      const r = e.target.getBoundingClientRect(); tip.style.left = (r.left + 6) + 'px'; tip.style.top = r.top + 'px';
    });
    cell.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    grid.append(cell);
  }
  container.append(grid, tip);
  requestAnimationFrame(() => { grid.scrollLeft = grid.scrollWidth; });
  return grid;
}

export function sparkline(values, color = 'var(--accent)', w = 90, hgt = 26) {
  const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt });
  if (values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1) * (w - 2) + 1).toFixed(1)} ${(hgt - 2 - (v - min) / (max - min || 1) * (hgt - 4)).toFixed(1)}`).join(' ');
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
  return svg;
}

/** Simple moving average helper. */
export function movingAverage(values, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(sum / Math.min(i + 1, n));
  }
  return out;
}
