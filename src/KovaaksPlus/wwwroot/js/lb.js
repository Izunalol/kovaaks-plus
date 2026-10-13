// Leaderboards: KovaaK's scenario boards (global / friends / around me) and evxl benchmark boards
// (global / friends / country / country averages), laid out like evxl.app.
import { call } from './rpc.js';
import { h, icon, seg, flag, fmtScore, fmtPct, timeAgo, rankColor, toast, debounce, modal } from './ui.js';
import { state } from './state.js';
import { playerRowProps, viewedSteamId } from './viewing.js';

function playerCell(r) {
  return h('div', { class: 'lb-player' }, flag(r.country), h('span', { style: r.self ? { color: 'var(--text)', fontWeight: 700 } : null }, r.name || r.steamAccountName || r.webappUsername || '?'),
    r.self ? h('span', { class: 'badge accent' }, 'You') : null);
}

function posCell(pos) {
  return h('td', { class: 'pos' + (pos <= 3 ? ' top' + pos : '') }, pos != null ? '#' + Number(pos).toLocaleString() : '—');
}

function pager(page, total, max, onPage) {
  const pages = Math.max(1, Math.ceil((total || 0) / max));
  return h('div', { class: 'row' },
    h('button', { class: 'btn sm icon', disabled: page <= 0, onclick: () => onPage(page - 1) }, icon('arrowLeft')),
    h('span', { class: 'small muted num' }, `Page ${page + 1} of ${pages.toLocaleString()}`),
    h('button', { class: 'btn sm icon', disabled: page + 1 >= pages, onclick: () => onPage(page + 1) }, icon('arrowLeft', 'flip-x')));
}

/** Scenario rank info from thresholds: rank index and % above that rank's threshold. */
export function scenarioRank(score, rankMaxes) {
  if (!rankMaxes || !rankMaxes.length || !score) return { r: 0, over: null };
  const r = rankMaxes.filter((t) => score >= t).length;
  const base = r > 0 ? rankMaxes[r - 1] : rankMaxes[0];
  return { r, over: base ? (score / base - 1) : null };
}

function rankPillFor(score, ctx) {
  if (!ctx || !ctx.rankMaxes) return null;
  const { r, over } = scenarioRank(score, ctx.rankMaxes);
  const names = ctx.rankNames || [];
  const rk = r > 0 ? (names[r - 1] || (ctx.ranks || [])[r]) : null;
  if (!rk) return h('span', { class: 'small muted' }, 'Unranked');
  const color = rankColor(rk, r);
  return h('span', { class: 'rank-pill', '--rc': color, style: { height: '22px', padding: '0 8px', fontSize: '11px' } },
    rk.name.toUpperCase(), over != null && over > 0 ? h('span', { style: { opacity: .8, fontWeight: 600 } }, `+${Math.round(over * 100)}%`) : null);
}

// ===================================================================== scenario leaderboard
/**
 * opts: { name, compact, max, rankMaxes, rankNames, ranks, scope }
 */
export function scenarioLeaderboard(container, opts) {
  const max = opts.max || (opts.compact ? 10 : 50);
  let scope = opts.scope || 'global';
  let page = 0;
  const bar = h('div', { class: 'lb-bar' });
  const body = h('div');
  container.append(bar, body);

  let last = null;
  const load = async () => {
    drawBar(last && last.scope === scope ? last : null);
    body.replaceChildren(h('div', { class: 'row muted small', style: { padding: '14px 4px' } }, h('div', { class: 'spinner' }), scope === 'friends' ? 'Checking your friends\' scores…' : 'Loading leaderboard…'));
    let res;
    try { res = await call('lb.scenario', { name: opts.name, scope, page, max }); last = { ...res, scope }; }
    catch (e) { body.replaceChildren(h('div', { class: 'muted small' }, e.message)); return; }
    if (res.error) { body.replaceChildren(h('div', { class: 'muted small', style: { padding: '10px 0' } }, res.error)); drawBar(res); return; }
    if (scope === 'me' && res.page != null) page = res.page;
    drawBar(res);
    let rows = res.rows || [];
    if (opts.compact && rows.length > max) {
      // Keep the top of the list, but always show your own row.
      const self = rows.find((r) => r.self);
      rows = rows.slice(0, max);
      if (self && !rows.includes(self)) rows = [...rows.slice(0, max - 1), self];
    }
    if (!rows.length) { body.replaceChildren(h('div', { class: 'muted small', style: { padding: '10px 0' } }, scope === 'friends' ? 'None of your Steam friends have a score here yet.' : 'No scores yet.')); return; }
    const showRank = !!opts.rankMaxes;
    body.replaceChildren(h('table', { class: 'table lb-table' },
      h('thead', null, h('tr', null, h('th', null, 'Pos'), h('th', null, 'Player'), h('th', { class: 'r' }, 'Score'),
        showRank ? h('th', null, 'Rank') : null,
        !opts.compact ? h('th', { class: 'r' }, 'Acc') : null, !opts.compact ? h('th', { class: 'r' }, 'Sens') : null, !opts.compact ? h('th', { class: 'r' }, 'Date') : null)),
      h('tbody', null, rows.map((r) => h('tr', { class: 'click' + (r.self ? ' self' : '') + (r.steamId && r.steamId === viewedSteamId() ? ' viewing' : ''), ...playerRowProps({ steamId: r.steamId, name: r.name, country: r.country }) },
        posCell(r.rank), h('td', null, playerCell(r)), h('td', { class: 'r' }, h('b', null, fmtScore(r.score))),
        showRank ? h('td', null, rankPillFor(r.score, opts)) : null,
        !opts.compact ? h('td', { class: 'r muted' }, r.accuracy != null ? fmtPct(r.accuracy) : '—') : null,
        !opts.compact ? h('td', { class: 'r muted' }, r.cm360 ? `${(+r.cm360).toFixed(1)} cm` : r.sens ? `${(+r.sens).toFixed(2)} ${r.sensScale || ''}` : '—') : null,
        !opts.compact ? h('td', { class: 'r muted' }, r.epoch ? timeAgo(r.epoch) : '') : null)))));
  };

  const drawBar = (res) => {
    const me = res && res.me;
    bar.replaceChildren(
      seg([{ value: 'global', label: 'Global' }, { value: 'friends', label: 'Friends' }, { value: 'me', label: 'My position' }], scope, (v) => { scope = v; page = 0; load(); }),
      me && me.position ? h('span', { class: 'lb-me' }, icon('medal'), 'You: ', h('b', null, '#' + me.position.toLocaleString()), h('span', { class: 'muted' }, ` of ${me.players.toLocaleString()} · top ${(me.position / me.players * 100).toFixed(me.position / me.players < 0.01 ? 2 : 1)}%`)) : null,
      res && res.localBest && scope !== 'friends' && !(me && me.position) ? h('span', { class: 'small muted' }, `Your best: ${fmtScore(res.localBest)}`) : null,
      h('div', { class: 'grow' }),
      res && res.total && scope !== 'friends' && !opts.compact ? pager(page, res.total, max, (p) => { page = p; load(); }) : null,
      res && scope === 'friends' && res.friendCount != null ? h('span', { class: 'small muted' }, `${res.friendCount} friends play KovaaK's`) : null,
      res && res.total && scope !== 'friends' && opts.compact ? h('span', { class: 'small muted' }, `${Number(res.total).toLocaleString()} players`) : null);
  };

  load();
}

export function openScenarioLeaderboard(name, display) {
  const host = h('div');
  modal({ title: 'Leaderboard · ' + (display || name), body: host, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  scenarioLeaderboard(host, { name });
}

// ===================================================================== benchmark leaderboard
export function benchmarkLeaderboard(container, b) {
  let mode = 'overall';
  let scope = 'global';
  let page = 0;
  let country = state.lbCountry || '';
  let search = '';
  let scenario = b.categories.flatMap((c) => c.scenarios)[0]?.name;
  const max = 50;
  const bar = h('div', { class: 'lb-bar' });
  const body = h('div');
  container.append(bar, body);
  const rankCtx = (name) => {
    const s = b.categories.flatMap((c) => c.scenarios).find((x) => x.name === name);
    return s ? { rankMaxes: s.rankMaxes, rankNames: b.rankNames, ranks: b.ranks } : {};
  };

  const drawBar = (total) => {
    const searchIn = h('input', { class: 'input', placeholder: 'Search by username…', value: search, style: { width: '200px' } });
    searchIn.addEventListener('input', debounce(() => { search = searchIn.value.trim(); page = 0; load(); }, 350));
    const countryIn = h('input', { class: 'input', placeholder: 'AU', value: country, maxlength: 2, style: { width: '60px', textTransform: 'uppercase' } });
    countryIn.addEventListener('change', () => { country = countryIn.value.trim().toUpperCase(); state.lbCountry = country; page = 0; load(); });
    const scenSel = h('select', { class: 'input', style: { maxWidth: '280px' } }, b.categories.flatMap((c) => c.scenarios).map((s) => h('option', { value: s.name, selected: s.name === scenario }, s.customName || s.name)));
    scenSel.addEventListener('change', () => { scenario = scenSel.value; load(); });
    bar.replaceChildren(
      seg([{ value: 'overall', label: 'Overall' }, { value: 'scenario', label: 'Scenario' }], mode, (v) => { mode = v; page = 0; load(); }),
      mode === 'scenario' ? scenSel : seg([{ value: 'global', label: 'Global' }, { value: 'friends', label: 'Friends' }, { value: 'country', label: 'Country' }, { value: 'countries', label: 'Countries' }], scope, (v) => { scope = v; page = 0; load(); }),
      mode === 'overall' && scope === 'country' ? countryIn : null,
      mode === 'overall' && scope !== 'countries' ? h('button', { class: 'btn sm', onclick: () => { scope = 'me'; load(); } }, icon('medal'), 'My position') : null,
      mode === 'overall' && (scope === 'global' || scope === 'country') ? searchIn : null,
      h('div', { class: 'grow' }),
      mode === 'overall' && total && scope !== 'countries' && scope !== 'friends' && scope !== 'me' ? pager(page, total, max, (p) => { page = p; load(); }) : null);
  };

  const load = async () => {
    if (mode === 'scenario') {
      drawBar();
      body.replaceChildren();
      scenarioLeaderboard(body, { name: scenario, ...rankCtx(scenario) });
      return;
    }
    body.replaceChildren(h('div', { class: 'row muted small', style: { padding: '14px 4px' } }, h('div', { class: 'spinner' }), 'Loading leaderboard…'));
    try {
      if (scope === 'countries') {
        drawBar();
        const res = await call('lb.countries', { id: b.id });
        const rows = (res && res.data) || [];
        body.replaceChildren(rows.length ? h('table', { class: 'table lb-table' },
          h('thead', null, h('tr', null, h('th', null, 'Pos'), h('th', null, 'Country'), h('th', { class: 'r' }, 'Players'), h('th', null, 'Avg rank'), h('th', { class: 'r' }, 'Avg energy'), h('th', { class: 'r' }, 'Avg cm/360'))),
          h('tbody', null, rows.map((r, i) => h('tr', { class: 'click', onclick: () => { country = r.country; state.lbCountry = country; scope = 'country'; load(); } },
            posCell(i + 1), h('td', null, h('div', { class: 'lb-player' }, flag(r.country), h('span', null, r.country))),
            h('td', { class: 'r' }, r.totalPlayers), h('td', null, overallPill(r.avgRankName)), h('td', { class: 'r' }, r.avgEnergy != null ? Math.round(r.avgEnergy) : '—'),
            h('td', { class: 'r muted' }, r.avgCm360 ? r.avgCm360.toFixed(1) : '—')))))
          : h('div', { class: 'muted small' }, 'No country data for this benchmark yet.'));
        return;
      }
      if (scope === 'country' && !country) { drawBar(); body.replaceChildren(h('div', { class: 'muted small', style: { padding: '10px 0' } }, 'Enter a two-letter country code (e.g. AU, US, GB).')); return; }
      const res = await call('lb.benchmark', { id: b.id, scope: scope === 'country' ? 'global' : scope, page, max, search: search || null, country: scope === 'country' ? country : null });
      const rows = (res && res.data) || [];
      drawBar(res && res.total);
      if (!rows.length) { body.replaceChildren(h('div', { class: 'muted small', style: { padding: '10px 0' } }, scope === 'friends' ? 'None of your friends are ranked on this benchmark yet.' : scope === 'me' ? 'You\'re not on this leaderboard yet (evxl updates from KovaaK\'s leaderboards).' : 'No entries.')); return; }
      body.replaceChildren(h('table', { class: 'table lb-table' },
        h('thead', null, h('tr', null, h('th', null, 'Pos'), h('th', null, 'Player'), h('th', null, 'Rank'), h('th', { class: 'r' }, 'Energy'), h('th', { class: 'r' }, 'Progress'), h('th', { class: 'r' }, 'cm/360'), h('th', { class: 'r' }, 'Active'))),
        h('tbody', null, rows.map((r) => {
          const self = r.steamId === state.config.steamId;
          return h('tr', { class: 'click' + (self ? ' self' : '') + (r.steamId === viewedSteamId() ? ' viewing' : ''), ...playerRowProps({ steamId: r.steamId, name: r.webappUsername || r.steamAccountName, country: r.country }, b.id) },
            posCell(r.position), h('td', null, playerCell({ name: r.webappUsername || r.steamAccountName, country: r.country, self })),
            h('td', null, overallPill(r.rankName)), h('td', { class: 'r' }, h('b', null, r.energy != null ? Math.round(r.energy) : '—')),
            h('td', { class: 'r muted' }, r.progress != null ? Math.round(r.progress * 100) + '%' : '—'),
            h('td', { class: 'r muted' }, r.avgCm360 ? r.avgCm360.toFixed(1) : '—'),
            h('td', { class: 'r muted' }, r.lastEpoch ? timeAgo(r.lastEpoch) : ''));
        }))));
    } catch (e) { body.replaceChildren(h('div', { class: 'muted small' }, e.message)); }
  };

  function overallPill(rankName) {
    if (!rankName) return h('span', { class: 'muted small' }, '—');
    const base = rankName.replace(/\s+complete$/i, '').trim();
    const all = [...(b.rankNames || []), ...(b.ranks || [])];
    const rk = all.find((x) => x.name && x.name.trim().toLowerCase() === base.toLowerCase()) || { name: base };
    return h('span', { class: 'rank-pill', '--rc': rankColor(rk, 3), style: { height: '22px', padding: '0 9px', fontSize: '11px' } }, rankName);
  }

  load();
}
