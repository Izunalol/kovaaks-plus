import { call } from '../rpc.js';
import { h, icon, fmtScore, fmtDuration, fmtDate, timeAgo, seg , runRowClass } from '../ui.js';
import { state, loadLibrary, scenario, displayName, subscribe } from '../state.js';
import { heatmap, barChart } from '../charts.js';
import { openScenario } from '../drawer.js';
import { scenarioMenu } from '../menus.js';
import { previewed } from '../hover.js';

export async function render(page) {
  const body = h('div', { class: 'col', style: { gap: '18px' } }, h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto 10px' } }), 'Crunching your run history…'));
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Statistics'), h('div', { class: 'sub' }, 'Every run KovaaK\'s has saved to its stats folder.'))), body);

  let range = 30;
  const draw = async () => {
    let o, lib;
    try { [o, lib] = await Promise.all([call('stats.overview'), loadLibrary()]); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    body.replaceChildren();

    body.append(h('div', { class: 'grid c4' },
      tile('Total runs', o.totalRuns.toLocaleString()),
      tile('Scenarios played', o.totalScenarios.toLocaleString()),
      tile('Time aiming', fmtDuration(o.totalSeconds)),
      tile('Training since', fmtDate(o.first))));

    const heat = h('div');
    body.append(h('div', { class: 'card pad' }, h('h3', null, 'Training calendar', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'runs per day, last 12 months')), heat));
    heatmap(heat, o.daily);

    // ---- activity bars ----
    const days = lastNDays(range);
    const byDay = new Map(o.daily.map((d) => [d.day, d]));
    const activityHost = h('div'), pbHost = h('div');
    const rangeSeg = seg([{ value: 14, label: '14d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }], range, (v) => { range = v; draw(); });
    body.append(h('div', { class: 'grid c2' },
      h('div', { class: 'card pad' }, h('h3', null, 'Time aiming per day', h('span', { class: 'spacer' }), rangeSeg), activityHost),
      h('div', { class: 'card pad' }, h('h3', null, 'Personal bests per day'), pbHost)));
    requestAnimationFrame(() => {
      barChart(activityHost, days.map((d) => { const v = byDay.get(d.key); const m = v ? Math.round(v.seconds / 60) : 0; return { label: d.label, value: m, tip: `${d.long}: <b>${m} min</b> · ${v ? v.runs : 0} runs` }; }), { height: 170, labels: true });
      barChart(pbHost, days.map((d) => { const v = byDay.get(d.key); return { label: d.label, value: v ? v.pbs : 0, tip: `${d.long}: <b>${v ? v.pbs : 0} PBs</b>` }; }), { height: 170, labels: true, color: '#fbbf24' });
    });

    // ---- tag breakdown (by plays) ----
    const tagTotals = new Map();
    for (const s of lib) for (const t of s.tags) tagTotals.set(t, (tagTotals.get(t) || 0) + s.plays);
    const tagRows = state.tags.map((t) => ({ t, plays: tagTotals.get(t.id) || 0 })).filter((x) => x.plays).sort((a, b) => b.plays - a.plays);
    const maxTag = Math.max(1, ...tagRows.map((x) => x.plays));
    const tagCard = h('div', { class: 'card pad' }, h('h3', null, icon('tag'), 'Runs by tag'),
      tagRows.length ? h('div', { class: 'col', style: { gap: '9px' } }, tagRows.slice(0, 14).map(({ t, plays }) => h('div', { class: 'row', style: { cursor: 'pointer' }, onclick: () => (location.hash = '#/library?tag=' + t.id) },
        h('span', { style: { width: '140px' }, class: 'ellipsis' }, t.name),
        h('div', { class: 'grow progress', style: { height: '10px' } }, h('i', { style: { width: (plays / maxTag * 100) + '%', background: t.color } })),
        h('span', { class: 'num muted small', style: { width: '60px', textAlign: 'right' } }, plays.toLocaleString()))))
        : h('div', { class: 'muted small' }, 'Tag your scenarios to see where your training time goes.'));

    const recentPbs = o.recent.filter((r) => r.pb).slice(0, 10);
    const pbCard = h('div', { class: 'card pad' }, h('h3', null, icon('trophy'), 'Latest personal bests'),
      recentPbs.length ? h('table', { class: 'table' }, h('tbody', null, recentPbs.map((r) => h('tr', { class: 'click ' + runRowClass(r), onclick: () => openScenario(r.scenario), oncontextmenu: (e) => scenarioMenu(e, r.scenario) },
        previewed(h('td', { class: 'ellipsis', style: { maxWidth: '260px' } }, displayName(scenario(r.scenario)) || r.scenario), r.scenario),
        h('td', { class: 'r' }, h('b', null, fmtScore(r.score))), h('td', { class: 'r muted' }, timeAgo(r.date))))))
        : h('div', { class: 'muted small' }, 'No PBs in your last 60 runs. Time for a new one?'));
    body.append(h('div', { class: 'grid c2' }, tagCard, pbCard));

    body.append(h('div', { class: 'card pad' }, h('h3', null, 'Most played scenarios'),
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Scenario'), h('th', { class: 'r' }, 'Plays'), h('th', { class: 'r' }, 'Time'), h('th', { class: 'r' }, 'PB'), h('th', { class: 'r' }, 'Last played'))),
        h('tbody', null, o.top.map((t, i) => h('tr', { class: 'click', onclick: () => openScenario(t.scenario), oncontextmenu: (e) => scenarioMenu(e, t.scenario) },
          h('td', { class: 'muted' }, i + 1), previewed(h('td', null, displayName(scenario(t.scenario)) || t.scenario), t.scenario),
          h('td', { class: 'r' }, t.plays), h('td', { class: 'r muted' }, fmtDuration(t.seconds)), h('td', { class: 'r' }, h('b', null, fmtScore(t.pb))), h('td', { class: 'r muted' }, timeAgo(t.last))))))));
    const posCard = h('div', { class: 'card pad' });
    body.append(posCard);
    drawPositions(posCard);
  };
  const unsub = subscribe('statsReady', draw);

  // Best global positions (evxl's daily snapshot of your KovaaK's leaderboard placements).
  let posMode = 'percentile';
  let positions = null;
  async function drawPositions(card) {
    card.replaceChildren(h('h3', null, icon('medal'), 'Best leaderboard positions', h('span', { class: 'spacer' }),
      seg([{ value: 'percentile', label: 'By percentile' }, { value: 'raw', label: 'By position' }], posMode, (v) => { posMode = v; drawPositions(card); })));
    if (!state.config.steamId) { card.append(h('div', { class: 'muted small' }, 'Add your Steam ID in App Settings to see your leaderboard positions.')); return; }
    if (!positions) {
      card.append(h('div', { class: 'row muted small' }, h('div', { class: 'spinner' }), 'Loading positions from evxl.app…'));
      try { positions = await call('stats.positions'); } catch (e) { card.lastChild.replaceWith(h('div', { class: 'muted small' }, e.message)); return; }
      card.lastChild.remove();
    }
    const list = [...positions].sort((a, b) => posMode === 'raw' ? a.position - b.position : a.percentile - b.percentile).slice(0, 30);
    if (!list.length) { card.append(h('div', { class: 'muted small' }, 'No ranked results yet.')); return; }
    card.append(h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Scenario'), h('th', { class: 'r' }, 'Position'), h('th', { class: 'r' }, 'Players'), h('th', { class: 'r' }, 'Top %'))),
      h('tbody', null, list.map((p, i) => h('tr', { class: 'click', onclick: () => openScenario(p.name), oncontextmenu: (e) => scenarioMenu(e, p.name) },
        h('td', { class: 'muted' }, i + 1),
        previewed(h('td', null, displayName(scenario(p.name)) || p.name), p.name),
        h('td', { class: 'r' }, h('b', null, '#' + p.position.toLocaleString())),
        h('td', { class: 'r muted' }, p.players.toLocaleString()),
        h('td', { class: 'r' }, h('span', { class: p.percentile <= 1 ? 'badge gold' : 'badge' }, `${p.percentile < 0.1 ? p.percentile.toFixed(3) : p.percentile < 1 ? p.percentile.toFixed(2) : p.percentile.toFixed(1)}%`)))))),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${positions.length} rated scenarios · updated daily by evxl.app from KovaaK's leaderboards`));
  }
  draw();
  return () => unsub();
}

function tile(label, value) { return h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value)); }

function lastNDays(n) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    out.push({ key, label: d.toLocaleDateString(undefined, { day: 'numeric', month: n > 30 ? 'short' : undefined }), long: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
