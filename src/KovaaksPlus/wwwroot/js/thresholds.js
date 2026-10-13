// Benchmark rank thresholds on a scenario's score charts (side panel and results screen).
// The chosen benchmark is remembered in config.ui.chartThresholds: 'auto' (first: active/pinned benchmarks first),
// 'off', or a benchmark id (falls back to the first one when a scenario isn't in it).
import { call } from './rpc.js';
import { h, rankColor } from './ui.js';
import { state, saveConfig } from './state.js';
import { rankEntry } from './benchcalc.js';

const cache = new Map();   // scenario → Promise<[{id, name, difficulty, rankNames, ranks, rankMaxes}]>, per app session

export function loadThresholds(name) {
  if (!cache.has(name)) cache.set(name, call('bench.thresholds', { name }).catch(() => []));
  return cache.get(name);
}

const pref = () => (state.config.ui && state.config.ui.chartThresholds) || 'auto';

function setPref(v) {
  const ui = { ...(state.config.ui || {}), chartThresholds: v };
  state.config.ui = ui;
  saveConfig({ ui }).catch(() => { });
}

/** The benchmark whose lines to draw for this scenario, or null. */
export function pickBenchmark(list) {
  const p = pref();
  if (p === 'off' || !list.length) return null;
  return list.find((b) => b.id === p) || list[0];
}

/**
 * Lines and bands for lineChart. Only the thresholds around your scores are shown (the one below your worst run,
 * those inside your range, and the next one above your best), so the chart keeps a useful scale.
 */
export function thresholdOverlay(b, scores) {
  if (!b || !scores.length) return { hLines: [], bands: [] };
  const all = b.rankMaxes.map((v, i) => {
    const e = rankEntry(i + 1, b);
    return { y: v, label: `${e.name} ${v.toLocaleString()}`, color: rankColor(e, i + 1), icon: e.icon, align: 'start', solid: true };
  });
  const min = Math.min(...scores), max = Math.max(...scores);
  const shown = [...all.filter((l) => l.y < min).slice(-1), ...all.filter((l) => l.y >= min && l.y <= max), ...all.filter((l) => l.y > max).slice(0, 1)];
  const bands = shown.map((l, k) => ({ from: l.y, to: shown[k + 1] ? shown[k + 1].y : null, color: l.color }));
  return { hLines: shown, bands };
}

/** "No rank lines / <benchmark>" picker; onChange(benchmark | null). Null when the scenario is in no benchmark. */
export function thresholdPicker(list, current, onChange) {
  if (!list.length) return null;
  const sel = h('select', { class: 'input thr-pick', title: 'Show a benchmark\'s rank thresholds on this chart' },
    h('option', { value: 'off' }, 'No rank lines'),
    list.map((b) => h('option', { value: String(b.id) }, `${b.name}${b.difficulty ? ' · ' + b.difficulty : ''}`)));
  sel.value = current ? String(current.id) : 'off';
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', () => {
    const v = sel.value === 'off' ? 'off' : +sel.value;
    setPref(v);
    onChange(v === 'off' ? null : list.find((b) => b.id === v));
  });
  return sel;
}
