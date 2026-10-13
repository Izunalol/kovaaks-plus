// Score / rank / leaderboard calculators for benchmarks and single scenarios.
import { call } from './rpc.js';
import { h, icon, seg, fmtScore, rankColor, toast, modal } from './ui.js';
import { state } from './state.js';
import { play } from './play.js';
import { planBenchmark, rankEntry, rankOf } from './benchcalc.js';

const pctText = (p) => (p === Infinity ? '—' : p <= 0 ? 'done' : `+${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);

// ===================================================================== benchmark
export function benchmarkCalculator(container, b, res) {
  const energy = res.supported && res.params;
  const rankCount = res.rankCount || (b.rankNames || []).length;
  let mode = 'rank';
  const out = h('div', { style: { marginTop: '12px' } });
  const controls = h('div', { class: 'row wrap' });
  container.append(controls, out);

  const rankSel = h('select', { class: 'input', style: { width: '220px' } },
    Array.from({ length: rankCount }, (_, i) => i + 1).map((r) => h('option', { value: r, selected: r === Math.min(rankCount, (res.rank || 0) + 1) }, rankEntry(r, b).name)));
  const energyIn = h('input', { class: 'input num', type: 'number', min: 0, step: 10, value: Math.round(((res.energy || 0) + 50) / 10) * 10, style: { width: '120px' } });
  const posIn = h('input', { class: 'input num', type: 'number', min: 1, step: 1, placeholder: 'e.g. 1000', style: { width: '130px' } });
  const go = h('button', { class: 'btn primary', onclick: () => run() }, icon('target'), 'Calculate');
  [energyIn, posIn].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
  rankSel.addEventListener('change', () => run());

  const drawControls = () => controls.replaceChildren(
    seg([{ value: 'rank', label: 'Target rank' }, energy ? { value: 'energy', label: 'Target energy' } : null, { value: 'lb', label: 'Leaderboard position' }].filter(Boolean), mode, (v) => { mode = v; drawControls(); out.replaceChildren(); if (v === 'rank') run(); }),
    mode === 'rank' ? rankSel : mode === 'energy' ? energyIn : h('div', { class: 'row' }, h('span', { class: 'muted small' }, '#'), posIn),
    mode !== 'rank' ? go : null);

  async function run() {
    let target;
    let note = null;
    if (mode === 'rank') target = { rank: +rankSel.value };
    else if (mode === 'energy') target = { energy: +energyIn.value };
    else {
      const pos = Math.max(1, parseInt(posIn.value, 10) || 0);
      if (!pos) { toast('Enter a leaderboard position'); return; }
      out.replaceChildren(h('div', { class: 'row muted small' }, h('div', { class: 'spinner' }), 'Looking up that position…'));
      try {
        const page = Math.floor((pos - 1) / 50);
        const lb = await call('lb.benchmark', { id: b.id, page, max: 50 });
        const row = (lb.data || [])[(pos - 1) % 50] || (lb.data || []).slice(-1)[0];
        if (!row) { out.replaceChildren(h('div', { class: 'muted small' }, 'That position doesn\'t exist on this leaderboard yet.')); return; }
        note = `#${pos.toLocaleString()} is currently ${row.webappUsername || row.steamAccountName} (${row.rankName}${row.energy != null ? `, ${Math.round(row.energy)} energy` : ''}).`;
        if (energy && row.energy != null) target = { energy: Math.ceil(row.energy) + 1 };
        else {
          const base = (row.rankName || '').replace(/ complete$/i, '').toLowerCase();
          const idx = (b.rankNames || []).findIndex((r) => r.name.toLowerCase() === base);
          target = { rank: Math.max(1, idx + 1) };
        }
      } catch (e) { out.replaceChildren(h('div', { class: 'muted small' }, e.message)); return; }
    }
    render(planBenchmark(b, res, target), target, note);
  }

  function render(plan, target, note) {
    const label = target.rank ? rankEntry(target.rank, b).name : `${target.energy} energy`;
    const color = target.rank ? rankColor(rankEntry(target.rank, b), target.rank) : 'var(--accent-2)';
    const head = h('div', { class: 'calc-summary' },
      note ? h('div', { class: 'small muted', style: { marginBottom: '6px' } }, note) : null,
      plan.already ? h('div', null, h('b', { style: { color } }, target.rank ? `You already have ${label}. ` : `Your ${Math.round(res.energy || 0)} energy already beats ${plan.targetEnergy}. `), 'Nothing to improve.')
        : !plan.achievable ? h('div', { class: 'down' }, plan.note || 'Not reachable with this benchmark\'s scoring.')
          : h('div', null, 'To reach ', h('b', { style: { color } }, label),
            plan.mode === 'energy' ? ` (${plan.targetEnergy} energy), raise ${plan.items.length} subcategor${plan.items.length === 1 ? 'y' : 'ies'} to at least ${plan.level} energy:`
              : plan.mode === 'subcategory' ? `, improve one scenario in each of ${plan.items.length} subcategor${plan.items.length === 1 ? 'y' : 'ies'}:`
                : `, improve ${plan.items.length} scenario${plan.items.length === 1 ? '' : 's'}:`));
    if (!plan.items.length) { out.replaceChildren(head); return; }
    out.replaceChildren(head, h('table', { class: 'table calc-table' },
      h('thead', null, h('tr', null, h('th', null, 'Scenario'), h('th', null, plan.mode === 'scenario' ? 'Category' : 'Subcategory'), h('th', { class: 'r' }, 'Current'), h('th', { class: 'r' }, 'Needed'), h('th', { class: 'r' }, 'Increase'), plan.mode === 'energy' ? h('th', { class: 'r' }, 'Energy') : null, h('th'))),
      h('tbody', null, plan.items.map((it) => h('tr', null,
        h('td', { style: { fontWeight: 600 } }, it.customName || it.name),
        h('td', { class: 'muted' }, it.group),
        h('td', { class: 'r' }, it.current ? fmtScore(it.current) : '—'),
        h('td', { class: 'r' }, h('b', { style: { color } }, fmtScore(it.need))),
        h('td', { class: 'r' }, h('span', { class: 'calc-inc' }, it.current ? `+${fmtScore(it.need - it.current)}` : 'new'), h('span', { class: 'small muted', style: { marginLeft: '6px' } }, pctText(it.pct))),
        plan.mode === 'energy' ? h('td', { class: 'r muted' }, `${it.from} → ${it.to}`) : null,
        h('td', { class: 'r' }, h('button', { class: 'btn sm primary', onclick: () => play(it.name, null, { queue: plan.items.map((x) => x.name) }) }, icon('play'), 'Play')))))),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, plan.mode === 'energy'
        ? 'Sorted by smallest relative improvement. Energy uses a harmonic mean, so lifting your weakest subcategories is the fastest way up.'
        : 'Sorted by smallest relative improvement; for each group the easiest scenario to rank up is picked.'));
  }

  drawControls();
  run();
}

// ===================================================================== scenario
/** opts: { name, display, pb, benchmarks: [{id, name, difficulty}] } */
export function scenarioCalculator(container, opts) {
  let mode = 'score';
  let bench = null;   // { b, s } thresholds context
  const out = h('div', { style: { marginTop: '10px' } });
  const controls = h('div', { class: 'row wrap' });
  container.append(controls, out);
  const pb = opts.pb || 0;

  const scoreIn = h('input', { class: 'input num', type: 'number', min: 0, step: 'any', value: pb ? Math.round(pb * 1.05) : '', placeholder: 'Score', style: { width: '120px' } });
  const posIn = h('input', { class: 'input num', type: 'number', min: 1, placeholder: '#1000', style: { width: '110px' } });
  const topIn = h('input', { class: 'input num', type: 'number', min: 0.01, max: 100, step: 'any', placeholder: 'top %', style: { width: '90px' } });
  const benchSel = h('select', { class: 'input', style: { maxWidth: '220px' } }, (opts.benchmarks || []).map((x) => h('option', { value: x.id }, `${x.name || 'Benchmark'}${x.difficulty ? ' · ' + x.difficulty : ''}`)));
  const rankSel = h('select', { class: 'input', style: { width: '160px' } });
  const go = h('button', { class: 'btn primary sm', onclick: () => run() }, 'Calculate');
  [scoreIn, posIn, topIn].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
  benchSel.addEventListener('change', () => loadBench().then(() => { if (mode === 'rank') run(); }));
  rankSel.addEventListener('change', () => run());

  async function loadBench() {
    const id = +benchSel.value;
    if (!id) { bench = null; return; }
    try {
      const b = await call('evxl.benchmark', { id });
      const s = b.categories.flatMap((c) => c.scenarios).find((x) => x.name.toLowerCase() === opts.name.toLowerCase());
      bench = s ? { b, s } : null;
      rankSel.replaceChildren(...(s ? s.rankMaxes.map((t, i) => h('option', { value: i + 1, selected: i === Math.min(s.rankMaxes.length - 1, rankOf(pb, s.rankMaxes).baseRank) }, `${rankEntry(i + 1, b).name} (${fmtScore(t)})`)) : []));
    } catch { bench = null; }
  }

  const drawControls = () => controls.replaceChildren(
    seg([{ value: 'score', label: 'Score' }, opts.benchmarks && opts.benchmarks.length ? { value: 'rank', label: 'Rank' } : null, { value: 'lb', label: 'Leaderboard' }].filter(Boolean), mode, (v) => { mode = v; drawControls(); out.replaceChildren(); if (v === 'rank') run(); }),
    mode === 'score' ? scoreIn : null,
    mode === 'rank' ? benchSel : null, mode === 'rank' ? rankSel : null,
    mode === 'lb' ? h('div', { class: 'row' }, posIn, h('span', { class: 'small muted' }, 'or'), topIn) : null,
    mode !== 'rank' ? go : null);

  function rankOfScore(score) {
    if (!bench) return null;
    const r = rankOf(score, bench.s.rankMaxes).baseRank;
    const e = rankEntry(r, bench.b);
    return { r, name: e.name, color: rankColor(e, r) };
  }

  async function run() {
    let need = null;
    let lines = [];
    if (mode === 'score') need = parseFloat(scoreIn.value);
    else if (mode === 'rank') {
      if (!bench) await loadBench();
      if (!bench) { out.replaceChildren(h('div', { class: 'muted small' }, 'No thresholds for this scenario.')); return; }
      need = bench.s.rankMaxes[+rankSel.value - 1];
    } else {
      const pos = parseInt(posIn.value, 10), top = parseFloat(topIn.value);
      if (!pos && !top) { toast('Enter a position or a top %'); return; }
      out.replaceChildren(h('div', { class: 'row muted small' }, h('div', { class: 'spinner' }), 'Checking the leaderboard…'));
      const res = await call('lb.scoreAt', { name: opts.name, position: pos || 0, percent: pos ? null : top }).catch(() => null);
      if (!res || res.score == null) { out.replaceChildren(h('div', { class: 'muted small' }, 'Couldn\'t read that leaderboard position.')); return; }
      need = Math.round((res.score + 0.01) * 100) / 100;
      lines.push(`#${res.position.toLocaleString()} of ${res.total.toLocaleString()} currently has ${fmtScore(res.score)} (${res.name}).`);
    }
    if (!need || isNaN(need)) { toast('Enter a score'); return; }
    if (opts.benchmarks && opts.benchmarks.length && !bench) await loadBench();
    const diff = need - pb;
    const rk = rankOfScore(need);
    const tiles = [
      ['Target score', fmtScore(need)],
      ['Vs your PB', pb ? (diff <= 0 ? 'Already beaten' : `+${fmtScore(diff)} (${(diff / pb * 100).toFixed(1)}%)`) : 'No PB yet'],
      rk ? ['Rank', h('span', { style: { color: rk.color } }, rk.name)] : null,
      ['Leaderboard', h('span', { class: 'pos-est' }, '…')],
    ].filter(Boolean);
    out.replaceChildren(
      ...lines.map((l) => h('div', { class: 'small muted', style: { marginBottom: '8px' } }, l)),
      h('div', { class: 'calc-tiles' }, tiles.map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v)))));
    call('lb.position', { name: opts.name, score: need }).then((p) => {
      const el = out.querySelector('.pos-est');
      if (el) el.textContent = p ? `#${p.position.toLocaleString()} (top ${(p.position / p.total * 100).toFixed(p.position / p.total < 0.01 ? 2 : 1)}%)` : 'no online board';
    }).catch(() => { const el = out.querySelector('.pos-est'); if (el) el.textContent = '—'; });
  }

  drawControls();
  if (opts.benchmarks && opts.benchmarks.length) loadBench();
}

export function openScenarioCalculator(opts) {
  const host = h('div');
  modal({ title: 'Calculator · ' + (opts.display || opts.name), body: host, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  scenarioCalculator(host, opts);
}
