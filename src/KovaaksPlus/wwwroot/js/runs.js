// Run detail: Kovaak's-style graphs (score over time, score per minute, kills, accuracy, TTK, damage).
import { call } from './rpc.js';
import { h, modal, fmtScore, fmtPct, fmtDateTime, toast, seg } from './ui.js';
import { lineChart, movingAverage } from './charts.js';

const GRAPHS = [
  ['score', 'Score'], ['spm', 'Score / min'], ['kills', 'Kills'], ['kps', 'Kills / sec'], ['acc', 'Accuracy'], ['ttk', 'TTK'], ['dmg', 'Damage'],
];

/**
 * Rebuilds the run's timeline from the per-kill rows. Score uses the scenario's own rules
 * (kills × score-per-kill + damage × score-per-damage, × accuracy when the scenario multiplies by it),
 * scaled so the last point equals the real final score.
 */
export function runTimeline(d) {
  const kills = d.kills || [];
  const s = d.summary || {};
  const sc = d.scoring || {};
  const end = Math.max(s.fightTime > 5 ? s.fightTime : 0, sc.timeLimit || 0, kills.length ? kills[kills.length - 1].t || 0 : 0) || kills.length;
  let k = 0, hits = 0, shots = 0, dmg = 0;
  const pts = [{ t: 0, kills: 0, hits: 0, shots: 0, dmg: 0, raw: 0, ttk: null }];
  kills.forEach((e, i) => {
    k++; hits += e.hits; shots += e.shots; dmg += e.damage || 0;
    const acc = shots ? hits / shots : 1;
    let raw = (sc.scorePerKill || 0) * k + (sc.scorePerDamage || 0) * dmg;
    if (!sc.scorePerKill && !sc.scorePerDamage) raw = k;            // unknown rules: proportional to kills
    if (sc.multAccuracy) raw *= acc;
    pts.push({ t: e.t || (i + 1) * (end / Math.max(1, kills.length)), kills: k, hits, shots, dmg, raw, ttk: e.ttk });
  });
  const last = pts[pts.length - 1];
  const scale = last.raw > 0 && s.score ? s.score / last.raw : 1;
  pts.forEach((p) => { p.score = p.raw * scale; p.acc = p.shots ? p.hits / p.shots : null; });
  if (end > last.t) pts.push({ ...last, t: end, ttk: null });
  return { pts, end };
}

function rate(pts, key, windowSec, perSec) {
  // Change in `key` over the trailing window, per second (or per minute).
  return pts.map((p, i) => {
    let j = i;
    while (j > 0 && p.t - pts[j - 1].t <= windowSec) j--;
    const a = pts[j === i && i > 0 ? i - 1 : j];
    const dt = Math.max(0.5, p.t - a.t);
    return { x: p.t, y: ((p[key] - a[key]) / dt) * perSec };
  });
}

/** Renders a graph switcher into `container`. */
export function runGraphs(container, d, opts = {}) {
  let which = opts.initial || 'score';
  const host = h('div');
  const bar = h('div', { class: 'row wrap', style: { marginBottom: '10px' } });
  container.append(bar, host);
  const { pts, end } = runTimeline(d);
  const fmtT = (x) => x.toFixed(0) + 's';
  const color = opts.color || 'var(--accent)';
  const draw = () => {
    host.replaceChildren();
    const opt = { height: opts.height || 210, xLabels: fmtT };
    let series;
    if (which === 'score') series = [{ points: pts.map((p) => ({ x: p.t, y: p.score, tip: `<b>${fmtScore(p.score)}</b> at ${p.t.toFixed(1)}s` })), color, area: true, dots: false }];
    else if (which === 'spm') {
      const r = rate(pts, 'score', 10, 60);
      const avg = end ? (pts[pts.length - 1].score / end) * 60 : 0;
      series = [{ points: r.map((p) => ({ ...p, tip: `<b>${fmtScore(p.y)}</b> /min at ${p.x.toFixed(1)}s` })), color, area: true, dots: false }];
      opt.hLines = [{ y: avg, label: 'avg ' + fmtScore(avg), color: '#94a3b8' }];
    } else if (which === 'kills') series = [{ points: pts.map((p) => ({ x: p.t, y: p.kills, tip: `<b>${p.kills}</b> kills at ${p.t.toFixed(1)}s` })), color, area: true, dots: false }];
    else if (which === 'kps') {
      const r = rate(pts, 'kills', 5, 1);
      series = [{ points: r.map((p) => ({ ...p, tip: `<b>${p.y.toFixed(2)}</b> kills/s at ${p.x.toFixed(1)}s` })), color, area: true, dots: false }];
      opt.yTick = (v) => v.toFixed(1);
    } else if (which === 'acc') {
      series = [{ points: pts.filter((p) => p.acc != null).map((p) => ({ x: p.t, y: p.acc * 100, tip: `<b>${(p.acc * 100).toFixed(1)}%</b> at ${p.t.toFixed(1)}s` })), color: 'var(--accent-2)', area: true, dots: false }];
      opt.yTick = (v) => v.toFixed(0) + '%';
    } else if (which === 'ttk') {
      const k = pts.filter((p) => p.ttk != null);
      const sm = movingAverage(k.map((p) => p.ttk), 5);
      series = [
        { points: k.map((p, i) => ({ x: p.t, y: p.ttk, tip: `Kill #${i + 1} · <b>${p.ttk.toFixed(3)}s</b>` })), color: '#64748b', width: 1, dots: false },
        { points: k.map((p, i) => ({ x: p.t, y: sm[i] })), color, width: 2.5, dots: false },
      ];
      opt.yTick = (v) => v.toFixed(2) + 's';
    } else series = [{ points: pts.map((p) => ({ x: p.t, y: p.dmg, tip: `<b>${fmtScore(p.dmg)}</b> damage at ${p.t.toFixed(1)}s` })), color, area: true, dots: false }];
    if (!series[0].points.length) { host.append(h('div', { class: 'muted small', style: { padding: '20px' } }, 'No timeline data in this run file.')); return; }
    lineChart(host, series, opt);
  };
  bar.append(seg(GRAPHS.map(([v, l]) => ({ value: v, label: l })), which, (v) => { which = v; draw(); }));
  if (opts.note !== false) bar.append(h('span', { class: 'small muted', style: { marginLeft: 'auto' } }, d.scoring ? 'Score over time is rebuilt from the scenario\'s scoring rules' : 'Score over time is estimated from kills'));
  requestAnimationFrame(draw);
}

export async function showRunDetail(file, title) {
  let d;
  try { d = await call('stats.run', { file }); } catch (e) { toast(e.message, 'error'); return; }
  const s = d.summary;
  const body = h('div', { class: 'col', style: { gap: '16px' } });
  body.append(h('div', { class: 'kv' },
    kv('Score', fmtScore(s.score)), kv('Accuracy', fmtPct(s.accuracy)), kv('Kills', s.kills), kv('Avg TTK', s.avgTtk ? s.avgTtk.toFixed(3) + 's' : '—'),
    kv('Shots', `${s.hits}/${s.shots}`), kv('Sens', s.sens ? `${+s.sens.toFixed(3)} ${s.sensScale || ''}` : '—'), kv('FOV', s.fov ? `${s.fov} ${s.fovScale || ''}` : '—'), kv('Avg FPS', s.avgFps || '—')));
  const g = h('div', { class: 'card pad' });
  body.append(g);
  if ((d.kills || []).length) runGraphs(g, d); else g.append(h('div', { class: 'muted small' }, 'This run file has no per-kill data.'));
  modal({ title: (title || s.scenario) + ' · ' + fmtDateTime(s.date), body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}

function kv(label, value) { return h('div', null, h('span', null, label), h('b', null, value)); }
