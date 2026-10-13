import { call } from '../rpc.js';
import { h, icon, thumb, fmtScore, fmtPct, fmtDuration, timeAgo, rankColor, isToday, runRowClass, rankImg } from '../ui.js';
import { state, loadLibrary, scenario, displayName, primaryTagColor, subscribe } from '../state.js';
import { openScenario, play } from '../drawer.js';
import { scenarioThumb } from '../thumbs.js';
import { cardPreview, previewed } from '../hover.js';
import { scenarioMenu } from '../menus.js';
import { evxlRankIcon } from '../benchcalc.js';
import { sparkline } from '../charts.js';

export async function render(page) {
  const greeting = (() => { const hr = new Date().getHours(); return hr < 5 ? 'Late night grind' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; })();
  const head = h('div', { class: 'page-head' }, h('div', null,
    h('h1', null, `${greeting}${state.config.steamName ? ', ' + state.config.steamName : ''}`),
    h('div', { class: 'sub' }, 'Pick a scenario and KovaaK\'s comes forward. Pause or finish and you\'re back here.')));
  const body = h('div', { class: 'col', style: { gap: '18px' } });
  page.append(head, body);

  const progress = h('div');
  body.append(progress);
  const unsub = subscribe('statsProgress', (d) => drawProgress(progress, d));
  const unsub2 = subscribe('statsReady', () => draw());
  drawProgress(progress, state.statsProgress);

  async function draw() {
    let overview, lib;
    try { [overview, lib] = await Promise.all([call('stats.overview'), loadLibrary()]); }
    catch (e) { body.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Couldn\'t load stats'), e.message)); return; }
    body.replaceChildren(progress);

    // ---- today tiles ----
    const streak = calcStreak(overview.daily);
    body.append(h('div', { class: 'grid c5' },
      tile('Time today', fmtDuration(overview.today.seconds), 'clock', null, `${overview.today.runs} run${overview.today.runs === 1 ? '' : 's'}`),
      tile('Total time aiming', fmtDuration(overview.totalSeconds), 'target', null, `${overview.totalRuns.toLocaleString()} runs · ${overview.totalScenarios.toLocaleString()} scenarios`),
      tile('PBs today', overview.today.pbs, 'trophy', overview.today.pbs ? 'var(--gold)' : null),
      tile('Day streak', streak, 'fire', streak >= 3 ? '#fb923c' : null, streak ? 'Keep it going' : 'Play today to start one'),
      tile('This week', fmtDuration(weekSeconds(overview.daily)), 'chart', null, `${weekRuns(overview.daily)} runs in the last 7 days`)));

    // ---- continue + favorites ----
    const lastRun = overview.recent[0];
    const lastScen = lastRun ? scenario(lastRun.scenario) : null;
    const favs = lib.filter((s) => s.favorite).sort((a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0)).slice(0, 8);

    const cont = lastRun ? h('div', { class: 'card', style: { overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' } },
      h('div', { style: { position: 'relative', minHeight: '190px' } }, (lastScen ? scenarioThumb(lastScen) : thumb(lastRun.scenario, null)),),
      h('div', { style: { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { class: 'small muted', style: { textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 } }, 'Continue'),
        h('div', { style: { font: '700 20px/1.2 var(--font-display)' } }, displayName(lastScen) || lastRun.scenario),
        h('div', { class: 'row small muted', style: { gap: '16px' } }, h('span', null, 'PB ', h('b', { style: { color: 'var(--text)' } }, fmtScore(lastScen?.pb))), h('span', null, `${lastScen?.plays || 0} plays`), h('span', null, timeAgo(lastRun.date))),
        h('div', { class: 'grow' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => play(lastRun.scenario) }, icon('play'), 'Play'),
          h('button', { class: 'btn ghost', onclick: () => openScenario(lastRun.scenario) }, 'Details')))) : h('div', { class: 'card pad empty' }, icon('target'), h('b', null, 'No runs yet'), 'Head to Scenarios and launch one.');
    cont.querySelector('.thumb')?.setAttribute('style', (cont.querySelector('.thumb').getAttribute('style') || '') + ';position:absolute;inset:0;aspect-ratio:auto');

    const favCard = h('div', { class: 'card pad' }, h('h3', null, icon('star', 'fav-star'), 'Favorites', h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => (location.hash = '#/library?fav=1') }, 'View all')),
      favs.length ? h('div', { class: 'col', style: { gap: '4px' } }, favs.map((s) => miniRow(s))) : h('div', { class: 'muted small' }, 'Star scenarios in the library to pin them here.'));

    body.append(h('div', { class: 'grid c2' }, cont, favCard));

    // ---- recent runs + benchmark ----
    const recent = h('div', { class: 'card pad' }, h('h3', null, 'Recent runs', h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => (location.hash = '#/stats') }, 'All stats')),
      overview.recent.length ? h('table', { class: 'table' }, h('tbody', null, (() => {
        // Today's runs first and bright; earlier ones dimmed under a separator. PBs get a gold gradient.
        const rows = [];
        let sep = null;
        overview.recent.slice(0, 12).forEach((r) => {
          const group = isToday(r.date) ? 'Today' : 'Earlier';
          if (group !== sep) { sep = group; rows.push(h('tr', { class: 'today-sep' }, h('td', { colspan: 4 }, group))); }
          const s = scenario(r.scenario);
          rows.push(previewed(h('tr', { class: 'click ' + runRowClass(r), onclick: () => openScenario(r.scenario), oncontextmenu: (e) => scenarioMenu(e, r.scenario) },
            h('td', { class: 'ellipsis', style: { maxWidth: '280px' } }, displayName(s) || r.scenario),
            h('td', { class: 'r' }, h('b', null, fmtScore(r.score)), r.pb ? h('span', { class: 'badge gold', style: { marginLeft: '8px' } }, 'PB') : null),
            h('td', { class: 'r muted' }, fmtPct(r.accuracy)),
            h('td', { class: 'r muted' }, timeAgo(r.date))), r.scenario));
        });
        return rows;
      })())) : h('div', { class: 'muted small' }, 'Nothing yet.'));

    const benchCard = h('div', { class: 'card pad' });
    body.append(h('div', { class: 'grid c2' }, recent, benchCard));
    drawBenchmark(benchCard);

    // ---- most played ----
    body.append(h('div', { class: 'card pad' }, h('h3', null, 'Most played'),
      h('div', { class: 'scen-grid' }, overview.top.slice(0, 6).map((t) => {
        const s = scenario(t.scenario) || { name: t.scenario, tags: [] };
        const th = scenarioThumb(s);
        th.append(h('button', { class: 'play-fab', onclick: (e) => { e.stopPropagation(); play(s.name); } }, icon('play')));
        const card = h('div', { class: 'scen-card', onclick: () => openScenario(t.scenario), oncontextmenu: (e) => scenarioMenu(e, t.scenario) },
          h('div', { class: 'thumb-wrap' }, th),
          h('div', { class: 'scen-body' }, h('div', { class: 'scen-name' }, displayName(s)),
            h('div', { class: 'scen-meta' }, h('span', null, 'PB ', h('b', null, fmtScore(t.pb))), h('span', null, h('b', null, t.plays), ' plays'), h('span', null, fmtDuration(t.seconds)))));
        cardPreview(card, th, s);
        return card;
      }))));
  }

  draw();
  return () => { unsub(); unsub2(); };
}

function drawProgress(el, d) {
  if (!d || d.done >= d.total) { el.replaceChildren(); return; }
  el.replaceChildren(h('div', { class: 'card pad' }, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('div', { class: 'spinner' }), h('b', null, 'Indexing your run history'), h('span', { class: 'muted small' }, `${d.done.toLocaleString()} / ${d.total.toLocaleString()} files · first launch only`)),
    h('div', { class: 'progress' }, h('i', { style: { width: (d.total ? d.done / d.total * 100 : 0) + '%' } }))));
}

function tile(label, value, ic, color, sub) {
  return h('div', { class: 'card stat' }, h('div', { class: 'row' }, h('div', { class: 'label grow' }, label), h('span', { style: { color: color || 'var(--muted)' } }, icon(ic))),
    h('div', { class: 'value', style: color ? { color } : null }, value),
    sub ? h('div', { class: 'delta' }, sub) : null);
}

function lastWeek(daily) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
  const key = new Date(cutoff.getTime() - cutoff.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return daily.filter((d) => d.day >= key);
}
const weekSeconds = (daily) => lastWeek(daily).reduce((a, d) => a + d.seconds, 0);
const weekRuns = (daily) => lastWeek(daily).reduce((a, d) => a + d.runs, 0);

function miniRow(s) {
  return previewed(h('div', { class: 'row filter-item', style: { padding: '6px 8px' }, onclick: () => openScenario(s.name), oncontextmenu: (e) => scenarioMenu(e, s.name) },
    h('div', { style: { width: '54px', borderRadius: '6px', overflow: 'hidden', flex: 'none' } }, scenarioThumb(s)),
    h('div', { class: 'grow' }, h('div', { class: 'ellipsis', style: { color: 'var(--text)', fontWeight: 600 } }, displayName(s)), h('div', { class: 'small muted' }, `PB ${fmtScore(s.pb)} · ${timeAgo(s.lastPlayed)}`)),
    h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); play(s.name); } }, icon('play'))), s.name);
}

function calcStreak(daily) {
  const days = new Set(daily.filter((d) => d.runs > 0).map((d) => d.day));
  const key = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const d = new Date();
  if (!days.has(key(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

async function drawBenchmark(card) {
  const id = state.config.activeBenchmark || (state.config.pinnedBenchmarks || [])[0];
  if (!id) {
    card.append(h('h3', null, icon('trophy'), 'Benchmark progress'), h('div', { class: 'muted small', style: { marginBottom: '12px' } }, 'Pin a benchmark to track your ranks here.'),
      h('button', { class: 'btn', onclick: () => (location.hash = '#/benchmarks') }, 'Browse benchmarks'));
    return;
  }
  card.append(h('h3', null, icon('trophy'), 'Benchmark progress'), h('div', { class: 'spinner' }));
  try {
    const b = await call('evxl.benchmark', { id });
    const rows = [];
    for (const c of b.categories) for (const s of c.scenarios) {
      const best = Math.max(s.localBest || 0, s.remoteScore || 0);
      const r = s.rankMaxes ? s.rankMaxes.filter((t) => best >= t).length : 0;
      rows.push({ s, best, r });
    }
    card.replaceChildren(
      h('h3', null, icon('trophy'), `${b.name}${b.difficulty ? ' · ' + b.difficulty : ''}`, h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => (location.hash = '#/benchmarks/' + id) }, 'Open')),
      h('div', { class: 'col', style: { gap: '3px' } }, rows.slice(0, 12).map(({ s, best, r }) => {
        const rank = b.ranks[r] || b.ranks[0] || {};
        const color = rankColor(rank, r);
        const next = s.rankMaxes ? s.rankMaxes[r] : null;
        const lower = r > 0 ? s.rankMaxes[r - 1] : 0;
        const prog = next ? Math.max(0, Math.min(1, (best - lower) / (next - lower))) : 1;
        return previewed(h('div', { class: 'row filter-item', style: { padding: '5px 6px' }, onclick: () => play(s.name), title: 'Play ' + s.name },
          h('span', { class: 'ellipsis grow', style: { color: 'var(--text)' } }, s.customName || s.name),
          h('div', { style: { width: '90px' } }, h('div', { class: 'progress' }, h('i', { style: { width: prog * 100 + '%', background: color } }))),
          h('span', { class: 'rank-pill', '--rc': color, style: { minWidth: '96px' } }, rankImg(evxlRankIcon(b.name, rank.name), 20), rank.name || '—')), s.name);
      })));
  } catch (e) {
    card.replaceChildren(h('h3', null, icon('trophy'), 'Benchmark progress'), h('div', { class: 'muted small' }, e.message));
  }
}
