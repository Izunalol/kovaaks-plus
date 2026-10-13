import { call } from '../rpc.js';
import { h, icon, fmtScore, timeAgo, rankColor, toast, debounce, seg, copyText, contextMenu, modal, toggle, rankImg } from '../ui.js';
import { benchmarkCalculator } from '../calc.js';
import { state, saveConfig, subscribe, loadLibrary, applyLibrary } from '../state.js';
import { play } from '../play.js';
import { openScenario } from '../drawer.js';
import { computeBenchmark, rankOf, rankEntry, CALC_INFO, SUPPORTED } from '../benchcalc.js';
import { benchmarkLeaderboard, openScenarioLeaderboard } from '../lb.js';
import { scenarioMenu } from '../menus.js';
import { previewed } from '../hover.js';
import { viewedPlayer, viewedSteamId, viewingBanner, findPlayer, viewPlayer, favoritesStrip } from '../viewing.js';

/** Favourite-player chips; redraws when favourites change. Returns [element, unsubscribe]. */
function favoritesHost() {
  const host = h('div');
  const draw = () => host.replaceChildren(...[favoritesStrip()].filter(Boolean));
  draw();
  return [host, subscribe('config', draw)];
}

export async function render(page, arg) {
  if (arg) return renderDetail(page, parseInt(arg, 10));
  return renderCatalog(page);
}

const pinned = (g) => g.difficulties.some((d) => (state.config.pinnedBenchmarks || []).includes(d.id));

async function togglePin(g) {
  const pins = new Set(state.config.pinnedBenchmarks || []);
  const on = pinned(g);
  g.difficulties.forEach((d) => pins.delete(d.id));
  if (!on) pins.add(g.difficulties[0].id);
  const patch = { pinnedBenchmarks: [...pins] };
  if (on && g.difficulties.some((d) => d.id === state.config.activeBenchmark)) patch.activeBenchmark = null;
  if (!on && !state.config.activeBenchmark) patch.activeBenchmark = g.difficulties[0].id;
  await saveConfig(patch);
}

// =============================================================== catalog (one card per benchmark, like evxl)
let catSort = 'played';
let catFilter = '';

async function renderCatalog(page) {
  const search = h('input', { class: 'input', placeholder: 'Search benchmarks or scenarios…', value: catFilter, style: { width: '320px' } });
  const status = h('span', { class: 'muted small' });
  const profileBox = h('div');
  const listBox = h('div');
  const [favHost, unsubFav] = favoritesHost();
  page.append(
    viewingBanner() || '',   // native append would print 'null'
    favHost,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Benchmarks'), h('div', { class: 'sub' }, 'Same benchmarks, layouts and scoring as evxl.app, combined with your local PBs so ranks update the moment a run ends.')),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ghost', title: 'View another player\'s benchmarks', onclick: () => findPlayer() }, icon('user'), 'Find player'),
      h('button', { class: 'btn ghost', onclick: () => load(true) }, icon('refresh'), 'Refresh')),
    profileBox,
    h('div', { class: 'toolbar', style: { marginTop: '18px' } },
      h('div', { class: 'search' }, icon('search'), search),
      seg([{ value: 'played', label: 'Most played' }, { value: 'name', label: 'A–Z' }, { value: 'new', label: 'Newest' }], catSort, (v) => { catSort = v; drawList(); }),
      h('div', { class: 'grow' }), status),
    listBox);

  let catalog = { groups: [] };
  let localPlayed = new Set();
  let ranks = new Map();     // "benchmark|difficulty" → evxl rank result
  search.addEventListener('input', debounce(() => { catFilter = search.value; drawList(); }, 120));

  const unsub = subscribe('catalog', (d) => {
    if (d.total > 0 && d.done >= 0) status.textContent = `Fetching benchmark names… ${d.done}/${d.total}`;
    if (d.done === -1) { status.textContent = ''; load(false); }
  });

  async function load(refresh) {
    try {
      catalog = await call('evxl.catalog', { refresh });
      const lib = await loadLibrary().catch(() => []);
      localPlayed = new Set(lib.filter((s) => s.plays > 0).map((s) => s.name.toLowerCase()));
      if (catalog.resolving && !status.textContent) status.textContent = 'Updating benchmark catalog…';
      drawList();
      loadProfile(refresh);
    } catch (e) { listBox.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Couldn\'t load benchmarks'), e.message)); }
  }

  async function loadProfile(refresh) {
    if (!state.config.steamId && !viewedSteamId()) {
      profileBox.replaceChildren(h('div', { class: 'card pad row' }, icon('trophy'), h('div', { class: 'grow' }, h('b', null, 'Add your Steam ID'), h('div', { class: 'small muted' }, 'See your evxl.app ranks on every benchmark.')), h('button', { class: 'btn', onclick: () => (location.hash = '#/settings') }, 'App settings')));
      return;
    }
    const prof = await call('evxl.profile', { refresh, steamId: viewedSteamId() }).catch(() => null);
    ranks = new Map(((prof && prof.results) || []).map((r) => [`${r.benchmarkName}|${r.difficultyName}`, r]));
    drawList();
  }

  const played = (g) => g.difficulties.reduce((a, d) => a + d.scenarios.filter((n) => localPlayed.has(n.toLowerCase())).length, 0);

  function card(g) {
    const isPinned = pinned(g);
    const n = played(g);
    return h('div', {
      class: 'card bg-card', '--gc': g.color || 'var(--accent)', onclick: () => (location.hash = '#/benchmarks/' + bestDifficulty(g).id),
      oncontextmenu: (e) => contextMenu(e, [
        { header: g.name },
        ...g.difficulties.map((d) => ({ label: 'Open ' + d.name, icon: 'trophy', onClick: () => (location.hash = '#/benchmarks/' + d.id) })),
        { sep: true },
        { label: isPinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => togglePin(g).then(drawList) },
      ]),
    },
      h('div', { class: 'bar' }),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('span', { class: 't ellipsis' }, g.name), g.abbreviation ? h('span', { class: 'abbr' }, g.abbreviation) : null,
          h('button', { class: 'btn ghost icon sm', title: isPinned ? 'Unpin' : 'Pin', onclick: (e) => { e.stopPropagation(); togglePin(g).then(drawList); } }, icon('pin', isPinned ? 'fav-star' : ''))),
        h('div', { class: 'chips' }, g.difficulties.map((d) => {
          const r = ranks.get(`${g.name}|${d.name}`);
          const ranked = r && r.rankName && !/unranked|no data|not complete/i.test(r.rankName);
          const rc = ranked ? rankColor({ name: r.rankName.replace(/ complete$/i, ''), color: (d.ranks || []).find((x) => r.rankName.toLowerCase().startsWith(x.name.toLowerCase()))?.color }, 3) : null;
          return h('span', { class: 'diff-chip', '--rc': rc, onclick: (e) => { e.stopPropagation(); location.hash = '#/benchmarks/' + d.id; }, title: `Open ${d.name}` },
            d.name, ranked ? h('b', null, r.rankName) : null);
        })),
        h('div', { class: 'row small muted' }, h('span', null, `${g.difficulties.reduce((a, d) => a + d.scenarioCount, 0)} scenarios`),
          n ? h('span', { class: 'up' }, `${n} played`) : null, g.rankCalculation ? h('span', { class: 'grow', style: { textAlign: 'right' } }, g.rankCalculation) : null)));
  }

  function bestDifficulty(g) {
    // Open the difficulty you're working on: the highest one with a rank, else the first.
    const withRank = g.difficulties.filter((d) => { const r = ranks.get(`${g.name}|${d.name}`); return r && r.rankName && !/unranked|no data/i.test(r.rankName); });
    return withRank[withRank.length - 1] || g.difficulties[0];
  }

  function drawList() {
    const q = catFilter.trim().toLowerCase();
    let groups = (catalog.groups || []).filter((g) => !q || `${g.name} ${g.abbreviation || ''}`.toLowerCase().includes(q) || g.difficulties.some((d) => d.scenarios.some((s) => s.toLowerCase().includes(q))));
    const sorters = {
      played: (a, b) => played(b) - played(a) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      new: (a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''),
    };
    groups = groups.sort(sorters[catSort]);
    const pins = groups.filter(pinned);
    const rest = groups.filter((g) => !pinned(g));
    listBox.replaceChildren(
      pins.length ? h('div', null, h('h2', { class: 'section-title' }, 'Pinned'), h('div', { class: 'bench-grid', style: { marginBottom: '22px' } }, pins.map(card))) : null,
      h('h2', { class: 'section-title' }, `All benchmarks · ${rest.length}`),
      rest.length ? h('div', { class: 'bench-grid' }, rest.map(card)) : h('div', { class: 'empty' }, (catalog.groups || []).length ? 'No benchmarks match.' : h('div', null, h('div', { class: 'spinner', style: { margin: '0 auto 10px' } }), 'Loading benchmark catalog from evxl.app…')));
  }

  load(false);
  return () => { unsub(); unsubFav(); };
}

// =============================================================== detail (evxl layout)
const customScores = new Map();   // "player|benchmarkId|scenario" → what-if score
let calcOpen = false;              // rank calculator card; closed by default each app launch
async function renderDetail(page, id) {
  const body = h('div', null, h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto 10px' } }), 'Loading benchmark…'));
  const viewer = viewedPlayer();
  const [favHost, unsubFav] = favoritesHost();
  page.append(h('div', { class: 'row', style: { marginBottom: '12px', flexWrap: 'wrap' } }, h('button', { class: 'btn ghost sm', onclick: () => (location.hash = '#/benchmarks') }, icon('arrowLeft'), 'All benchmarks'), h('div', { class: 'grow' }, favHost)), body);

  let current = null;
  const mainHost = h('div');
  const lbHost = h('div');
  const lbCard = h('div', { class: 'card pad', style: { marginTop: '18px' } }, h('h3', null, icon('medal'), 'Leaderboards'), lbHost);
  const load = async (refresh) => {
    try { current = await call('evxl.benchmark', { id, refresh, steamId: viewer ? viewer.steamId : null }); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Couldn\'t load this benchmark'), e.message)); return; }
    body.replaceChildren(...[viewingBanner(viewer ? `https://evxl.app/u/${viewer.steamId}/${encodeURIComponent(current.name)}/${encodeURIComponent(current.difficulty || '')}` : null), mainHost, lbCard].filter(Boolean));
    draw(current);
    lbHost.replaceChildren();
    benchmarkLeaderboard(lbHost, current);
  };
  const unsub = subscribe('run', () => { if (body.isConnected) load(false); });

  /** What-if scores you've typed into the table (kept for this app session). */
  // Keyed per player too, so what-ifs typed on someone else's table don't leak into yours.
  const customPrefix = `${viewer ? viewer.steamId : 'me'}|${id}|`;
  const customKey = (name) => customPrefix + name;
  const customCount = () => [...customScores.keys()].filter((k) => k.startsWith(customPrefix)).length;
  function withCustoms(b) {
    return { ...b, categories: b.categories.map((c) => ({ ...c, scenarios: c.scenarios.map((s) => customScores.has(customKey(s.name)) ? { ...s, customScore: customScores.get(customKey(s.name)) } : s) })) };
  }
  function setCustom(name, value) {
    if (value == null || isNaN(value)) customScores.delete(customKey(name)); else customScores.set(customKey(name), value);
    draw(current);
  }

  function draw(raw) {
    const b = withCustoms(raw);
    const res = computeBenchmark(b);
    const ranksN = (b.rankNames || []).length || Math.max(0, (b.ranks || []).length - 1);
    const energyMode = res.supported && res.energy != null;
    const evxl = b.evxlRank;
    const g = { difficulties: (b.difficulties || []).filter((d) => d.id > 0) };
    const isPinned = (state.config.pinnedBenchmarks || []).some((x) => g.difficulties.some((d) => d.id === x)) || (state.config.pinnedBenchmarks || []).includes(id);
    const active = state.config.activeBenchmark === id;

    // Overall: our local computation when the method is supported (fresher), else evxl's server rank.
    let overallLabel, overallColor, overallIcon;
    if (res.supported) {
      const e = rankEntry(res.rank, b);
      overallLabel = res.display; overallColor = rankColor(e, res.rank); overallIcon = e.icon;
    } else if (evxl && evxl.rankName) {
      const base = evxl.rankName.replace(/ complete$/i, '');
      const idx = (b.rankNames || []).findIndex((r) => r.name.toLowerCase() === base.toLowerCase());
      const e = idx >= 0 ? rankEntry(idx + 1, b) : { name: base };
      overallLabel = evxl.rankName; overallColor = rankColor(e, idx + 1); overallIcon = e.icon;
    } else {
      overallLabel = 'Unranked'; overallColor = '#6b7280';
    }

    const header = h('div', { class: 'bm-head' },
      h('div', { class: 'bm-title' }, b.abbreviation ? h('span', { class: 'bm-abbr', style: { background: b.color || 'var(--accent)' } }, b.abbreviation) : null, b.name),
      g.difficulties.length > 1 ? h('div', { class: 'diff-tabs' }, g.difficulties.map((d) =>
        h('button', { class: d.id === id ? 'on' : '', '--dc': b.color, onclick: () => (location.hash = '#/benchmarks/' + d.id) }, d.name))) : (b.difficulty ? h('span', { class: 'badge accent' }, b.difficulty) : null),
      h('div', { class: 'grow' }),
      b.sharecode ? h('button', { class: 'btn', title: 'Open the benchmark playlist inside KovaaK\'s', onclick: () => call('game.playPlaylist', { sharecode: b.sharecode }).catch((e) => toast(e.message, 'error')) }, icon('play'), 'Playlist') : null,
      h('button', { class: 'btn ghost', onclick: () => load(true) }, icon('refresh'), 'Refresh'),
      b.sharecode ? h('button', { class: 'btn ghost', title: 'Copy playlist share code', onclick: () => copyText(b.sharecode) }, icon('copy'), 'Sharecode') : null,
      b.spreadsheetUrl ? h('button', { class: 'btn ghost icon', title: 'Original spreadsheet', onclick: () => call('app.openUrl', { url: b.spreadsheetUrl }) }, icon('external')) : null,
      h('button', { class: 'btn ghost icon', title: 'Table settings', onclick: () => openTableSettings(() => tableHost.replaceChildren(benchTable(b, res, setCustom))) }, icon('sliders')),
      h('button', { class: 'btn ghost icon', title: 'More', onclick: (e) => contextMenu(e, [
        { label: 'View another player\'s scores…', icon: 'user', onClick: () => findPlayer() },
        viewer ? { label: 'Back to my scores', icon: 'arrowLeft', onClick: () => viewPlayer(null) } : null,
        { sep: true },
        { label: 'Auto-tag these scenarios', icon: 'tag', onClick: autoTag },
        { label: (state.config.benchmarkFilters || []).includes(id) ? 'Remove scenario filter' : 'Show as scenario filter', icon: 'library', onClick: async () => {
          const list = state.config.benchmarkFilters || [];
          const on = list.includes(id);
          await saveConfig({ benchmarkFilters: on ? list.filter((x) => x !== id) : [...list, id] });
          toast(on ? 'Removed from the Scenarios sidebar' : 'Added to the Scenarios sidebar under Benchmarks', 'ok');
        } },
        { label: 'View its scenarios in the library', icon: 'search', onClick: () => (location.hash = '#/library?bench=' + id) },
        { label: active ? 'Remove from home screen' : 'Show on home screen', icon: 'home', onClick: async () => { await saveConfig({ activeBenchmark: active ? null : id, pinnedBenchmarks: [...new Set([...(state.config.pinnedBenchmarks || []), id])] }); draw(b); } },
        { label: isPinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: async () => {
          const pins = new Set(state.config.pinnedBenchmarks || []);
          if (isPinned) { g.difficulties.forEach((d) => pins.delete(d.id)); pins.delete(id); } else pins.add(id);
          await saveConfig({ pinnedBenchmarks: [...pins] }); draw(b);
        } },
        viewer || state.config.steamId ? { label: viewer ? `Open ${viewer.name}'s page on evxl.app` : 'Open my page on evxl.app', icon: 'external', onClick: () => call('app.openUrl', { url: `https://evxl.app/u/${viewer ? viewer.steamId : state.config.steamId}/${encodeURIComponent(b.name)}/${encodeURIComponent(b.difficulty || '')}` }) } : null,
      ]) }, icon('settings')));

    async function autoTag() {
      try { const r = await call('library.autoTag', { ids: [id] }); applyLibrary(await call('library.list')); toast(`Tagged ${r.tagged} scenarios`, 'ok'); } catch (e) { toast(e.message, 'error'); }
    }

    const summary = h('div', { class: 'card bm-summary' },
      h('span', { class: 'rank-pill', '--rc': overallColor, style: { height: '36px', fontSize: '15px', padding: '0 16px 0 8px' } }, rankImg(overallIcon, 24), overallLabel),
      energyMode ? h('span', { class: 'bm-energy', title: 'Harmonic-mean energy' }, icon('bolt'), Math.round(res.energy)) : null,
      res.supported && res.progress != null && res.rank < ranksN ? h('div', { style: { width: '200px' } },
        h('div', { class: 'progress' }, h('i', { style: { width: Math.min(100, res.progress * 100) + '%', background: overallColor } })),
        h('div', { class: 'small muted', style: { marginTop: '4px' } }, `${Math.round(Math.min(1, res.progress) * 100)}% to ${rankEntry(res.rank + 1, b).name}`)) : null,
      evxl && evxl.rankName && res.supported && evxl.rankName !== res.display ? h('span', { class: 'small muted', title: 'evxl.app ranks from your KovaaK\'s leaderboard scores, which can lag behind local PBs' }, 'evxl.app: ', h('b', { style: { color: 'var(--text-2)' } }, evxl.rankName)) : null,
      h('div', { class: 'grow' }),
      b.offline ? h('span', { class: 'small down' }, 'offline (cached)') : null,
      h('span', { class: 'calc-chip', title: CALC_INFO[res.method] || 'Custom evxl scoring method. The overall rank shown comes from evxl.app.' }, 'Calc: ', h('b', null, res.method), SUPPORTED.has(res.method) ? null : ' (evxl)'));

    const nCustom = customCount();
    const customBar = nCustom ? h('div', { class: 'custom-bar' }, icon('edit'),
      h('span', { class: 'grow' }, h('b', null, `Showing ${nCustom} custom score${nCustom === 1 ? '' : 's'}. `), 'Ranks, energy and the calculator use these what-if values.'),
      h('button', { class: 'btn sm', onclick: () => { [...customScores.keys()].filter((k) => k.startsWith(customPrefix)).forEach((k) => customScores.delete(k)); draw(current); } }, icon('refresh'), 'Reset all')) : null;

    const tableHost = h('div', null, benchTable(b, res, setCustom));
    // Rank calculator: collapsed by default, built only when opened (stays open for the rest of the session once you open it).
    const calcHost = h('div', { class: 'calc-body' });
    const calcCard = h('div', { class: 'card pad collapsible' + (calcOpen ? ' open' : ''), style: { marginTop: '18px' } });
    const fillCalc = () => { calcHost.replaceChildren(); if (calcOpen) benchmarkCalculator(calcHost, b, res); };
    calcCard.append(h('h3', { class: 'collapse-head', onclick: () => { calcOpen = !calcOpen; calcCard.classList.toggle('open', calcOpen); fillCalc(); } },
      icon('target'), 'Rank calculator', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'What it takes to reach a rank, an energy, or a leaderboard spot'), icon('chevron', 'collapse-caret')), calcHost);
    fillCalc();
    mainHost.replaceChildren(header, summary, customBar, tableHost, calcCard);
  }

  load(false);
  return () => { unsub(); unsubFav(); };
}

// ---------------------------------------------------------------- table settings (like evxl's "Table Settings")
// Defaults mirror evxl.app's table (45° skew, 8/4px radii, rank colour mixed 55% with white).
const TABLE_VERSION = 2;
export const TABLE_DEFAULTS = {
  v: TABLE_VERSION, density: 'normal', progress: 'normal', skew: 45, outerRadius: 8, innerRadius: 4, shadeCategory: true, shadeRank: true,
  rankColumnColors: false, font: 'default', textSize: 100, rankTextContrast: 45, thresholdTextContrast: 45, scoreTextContrast: 45,
  energyTextContrast: 45, categoryTextContrast: 45, bold: true, textShadow: true,
  subGradient: false, gradientStrength: 22,
  showPosition: false, showProgress: true, uncappedProgress: false, simplifyNames: false,
};
export function tableSettings() {
  const saved = (state.config.ui || {}).benchTable || {};
  if (saved.v !== TABLE_VERSION) return { ...TABLE_DEFAULTS };
  const ts = { ...TABLE_DEFAULTS, ...saved };
  // Older single 'Text contrast' setting → both new sliders.
  if (saved.textContrast != null) { if (saved.rankTextContrast == null) ts.rankTextContrast = saved.textContrast; if (saved.scoreTextContrast == null) ts.scoreTextContrast = saved.textContrast; }
  // Thresholds/energy used to share the rank/score sliders.
  if (saved.thresholdTextContrast == null) ts.thresholdTextContrast = ts.rankTextContrast;
  if (saved.energyTextContrast == null) ts.energyTextContrast = ts.scoreTextContrast;
  delete ts.textContrast; delete ts.highContrast;
  return ts;
}

let saveTimer = null;
function saveTableSettings(ts) {
  const ui = JSON.parse(JSON.stringify(state.config.ui || {}));
  ui.benchTable = { ...ts, v: TABLE_VERSION };
  state.config.ui = ui;           // apply immediately; persist shortly after
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveConfig({ ui }).catch(() => { }), 400);
}

function openTableSettings(onChange) {
  const ts = tableSettings();
  const body = h('div', { class: 'ts-panel' });
  const set = (patch) => { Object.assign(ts, patch); saveTableSettings({ ...ts }); onChange(); if ('subGradient' in patch) draw(); };
  const segRow = (label, key, opts) => h('div', { class: 'ts-row' }, h('span', null, label), seg(opts.map(([v, l]) => ({ value: v, label: l })), ts[key], (v) => set({ [key]: v })));
  const sliderRow = (label, key, min, max, step, unit) => {
    const val = h('span', { class: 'small muted num', style: { width: '44px', textAlign: 'right' } }, ts[key] + unit);
    const r = h('input', { type: 'range', min, max, step, value: ts[key], style: { width: '150px', accentColor: 'var(--accent)' } });
    r.addEventListener('input', () => { val.textContent = r.value + unit; set({ [key]: +r.value }); });
    return h('div', { class: 'ts-row' }, h('span', null, label), h('div', { class: 'row' }, r, val));
  };
  const toggleRow = (label, key, hint) => h('div', { class: 'ts-row' }, h('span', null, label, hint ? h('small', null, hint) : null), toggle(ts[key], (v) => set({ [key]: v })));
  const draw = () => body.replaceChildren(
    h('div', { class: 'ts-group' }, 'Layout'),
    segRow('Density', 'density', [['ultra', 'Ultra'], ['compact', 'Compact'], ['normal', 'Normal'], ['wide', 'Wide']]),
    segRow('Progress bar', 'progress', [['normal', 'Normal'], ['simple', 'Simple']]),
    sliderRow('Skew', 'skew', 0, 45, 1, '°'),
    sliderRow('Outer radius', 'outerRadius', 0, 16, 1, 'px'),
    sliderRow('Inner radius', 'innerRadius', 0, 12, 1, 'px'),
    toggleRow('Shade category cells', 'shadeCategory', 'Tint category and subcategory labels with their own colour'),
    toggleRow('Shade rank cells', 'shadeRank', 'Dark track behind each threshold'),
    toggleRow('Use rank column colors', 'rankColumnColors', 'Fill each cell with its own rank colour instead of your current rank colour'),
    toggleRow('Subcategory gradient', 'subGradient', 'Right-to-left glow from the energy back to the scores, coloured by each subcategory\'s rank'),
    ts.subGradient ? sliderRow('Gradient strength', 'gradientStrength', 5, 60, 1, '%') : null,
    h('div', { class: 'ts-group' }, 'Text & display'),
    segRow('Font', 'font', [['default', 'Default'], ['condensed', 'Condensed'], ['mono', 'Mono']]),
    sliderRow('Text size', 'textSize', 80, 130, 5, '%'),
    h('div', { class: 'ts-sub' }, 'Text contrast (how far text is pushed towards white)'),
    sliderRow('Rank names', 'rankTextContrast', 0, 100, 5, '%'),
    sliderRow('Rank thresholds', 'thresholdTextContrast', 0, 100, 5, '%'),
    sliderRow('Your scores', 'scoreTextContrast', 0, 100, 5, '%'),
    sliderRow('Energy', 'energyTextContrast', 0, 100, 5, '%'),
    sliderRow('Category labels', 'categoryTextContrast', 0, 100, 5, '%'),
    toggleRow('Bold text', 'bold'),
    toggleRow('Text shadow', 'textShadow'),
    toggleRow('Show leaderboard position', 'showPosition', 'Your global position on each scenario'),
    toggleRow('Show progress %', 'showProgress'),
    toggleRow('Uncapped progress %', 'uncappedProgress', 'Show how far past the top rank you are'),
    toggleRow('Simplify scenario names', 'simplifyNames', 'Hide the benchmark prefix and difficulty suffix'));
  draw();
  modal({
    title: 'Table settings', body, panel: true,
    actions: [{ label: 'Reset defaults', kind: 'ghost', onClick: () => { Object.assign(ts, TABLE_DEFAULTS); saveTableSettings({ ...TABLE_DEFAULTS }); onChange(); draw(); return false; } }, { label: 'Done', kind: 'primary' }],
  });
}

/** "VT Pasu Intermediate S5" → "Pasu" (drops the benchmark prefix, difficulty and season). */
function simplifyName(name, b) {
  const words = name.split(/\s+/);
  const diffWords = (b.difficulty || '').toLowerCase().split(/\s+/).filter(Boolean);
  const abbr = (b.abbreviation || '').toLowerCase();
  while (words.length > 1 && (words[0].toLowerCase() === abbr || /^(vt|ra|cb|vts)$/i.test(words[0]))) words.shift();
  while (words.length > 1) {
    const w = words[words.length - 1].toLowerCase().replace(/[()]/g, '');
    if (/^s\d+(\.\d+)?$/.test(w) || diffWords.includes(w) || ['novice', 'intermediate', 'advanced', 'elite', 'easy', 'medium', 'hard'].includes(w)) words.pop();
    else break;
  }
  return words.join(' ');
}

const mixWhite = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, white)`;
const shade = (color) => `color-mix(in srgb, ${color} 85%, black)`;

/**
 * evxl-style table. Headers and cells are generated from one column list, so optional columns (position, progress)
 * can never misalign. Clicking a score lets you type a what-if value (onEdit(name, value|null)).
 */
function benchTable(b, res, onEdit) {
  const ts = tableSettings();
  const layout = res.layout;
  const list = res.list;
  const nThresh = Math.max(...list.map((s) => (s.rankMaxes || []).length), 0);
  const energyMode = !!(res.supported && res.subEnergies);
  const ranks = Array.from({ length: nThresh }, (_, i) => rankEntry(i + 1, b));
  const rankCol = ranks.map((r, i) => rankColor(r, i + 1));
  const rowH = { ultra: 22, compact: 26, normal: 31, wide: 40 }[ts.density] || 31;
  // Contrast = how far text is pushed towards white; the rest is the rank colour.
  const rankPct = 100 - ts.rankTextContrast;
  const thrPct = 100 - ts.thresholdTextContrast;
  const scorePct = 100 - ts.scoreTextContrast;
  const energyPct = 100 - ts.energyTextContrast;
  const catPct = 100 - ts.categoryTextContrast;
  const cols = [
    { key: 'cat' }, { key: 'sub' }, { key: 'name', label: 'Scenario' },
    ts.showPosition ? { key: 'pos', label: 'Pos', align: 'right' } : null,
    { key: 'score', label: 'Score', align: 'right' },
    ts.showProgress ? { key: 'pct' } : null,
    ...ranks.map((r, i) => ({ key: 'rank', i })),
    energyMode ? { key: 'energy', label: 'Energy', align: 'center' } : null,
  ].filter(Boolean);

  const thead = h('thead', null, h('tr', null, cols.map((c) => {
    if (c.key === 'rank') {
      const r = ranks[c.i];
      return h('th', { class: 'rk' }, h('div', { class: 'rk-head' }, rankImg(r.icon, 20), h('span', { style: { color: mixWhite(rankCol[c.i], rankPct) } }, r.name)));
    }
    return h('th', { class: 'th-' + c.key, style: c.align ? { textAlign: c.align } : null }, c.label || '');
  })));

  const rows = [];
  const groups = [];
  let idx = 0;
  for (const cat of layout) {
    const catRows = cat.subcategories.reduce((a, s) => a + s.scenarioCount, 0);
    const subKeys = keysOf(cat.subcategories);
    const catColor = cat.color || b.color || '#64748b';
    cat.subcategories.forEach((sub, si) => {
      const subColor = sub.color || catColor;
      // Gradient colour follows the subcategory: its energy rank, or (without energy) its average scenario rank.
      const subEn = energyMode ? res.subEnergies[cat.categoryName]?.[subKeys[si]] : null;
      const subList = list.slice(idx, idx + sub.scenarioCount).filter(Boolean);
      const subRank = energyMode ? (subEn != null ? res.thresholds.filter((x) => subEn >= x).length : 0)
        : Math.round(subList.reduce((a, s) => a + rankOf(s.score, s.rankMaxes).baseRank, 0) / Math.max(1, subList.length));
      const group = { rows: [], color: subRank > 0 ? rankColor(rankEntry(subRank, b), subRank) : null };
      if (group.color) groups.push(group);
      for (let k = 0; k < sub.scenarioCount; k++, idx++) {
        const s = list[idx];
        if (!s) continue;
        const r = rankOf(s.score, s.rankMaxes);
        const cur = rankColor(rankEntry(r.baseRank, b), r.baseRank);
        const fill = r.baseRank > 0 ? shade(cur) : '#71717a';
        const top = (s.rankMaxes || [])[s.rankMaxes.length - 1];
        const pct = !s.score ? '' : r.isMaxed ? (ts.uncappedProgress && top ? `+${Math.round((s.score / top - 1) * 100)}%` : '100%') : Math.round(r.progressToNext * 100) + '%';
        const custom = s.customScore != null;
        const tr = h('tr', { class: (s.score ? '' : 'unplayed') + (k === sub.scenarioCount - 1 ? ' last-sub' : ''), oncontextmenu: (e) => scenarioMenu(e, s.name) });
        for (const c of cols) {
          switch (c.key) {
            case 'cat':
              if (si === 0 && k === 0) tr.append(h('td', { class: 'vl', rowspan: catRows, style: { '--vc': mixWhite(catColor, catPct) } }, h('span', { style: { color: mixWhite(catColor, catPct) } }, cat.categoryName)));
              break;
            case 'sub':
              if (k === 0) tr.append(h('td', { class: 'vl', rowspan: sub.scenarioCount, style: { '--vc': mixWhite(subColor, catPct) } }, h('span', { style: { color: mixWhite(subColor, catPct) } }, sub.subcategoryName || '')));
              break;
            case 'name':
              tr.append(h('td', { class: 'sc' }, h('div', { class: 'sc-wrap' },
                previewed(h('span', { class: 'sc-name', title: s.name, onclick: () => openScenario(s.name) }, s.customName || (ts.simplifyNames ? simplifyName(s.name, b) : s.name)), s.name),
                h('button', { class: 'iconbtn', title: 'Leaderboard', onclick: () => openScenarioLeaderboard(s.name, s.customName) }, icon('chart')),
                h('button', { class: 'iconbtn', title: 'Play', onclick: () => play(s.name, null, { queue: list.map((x) => x.name) }) }, icon('play')))));
              break;
            case 'pos':
              tr.append(h('td', { class: 'pos' }, s.leaderboardRank ? '#' + Number(s.leaderboardRank).toLocaleString() : '—'));
              break;
            case 'score': {
              const td = h('td', { class: 'score' + (custom ? ' custom' : ''), title: custom ? 'Custom value: click to edit' : 'Click to try a what-if score' },
                custom ? h('span', { class: 'custom-tag' }, 'custom') : null,
                h('span', { class: 'score-val', style: { color: s.score ? mixWhite(cur, scorePct) : 'var(--muted)' } }, s.score ? fmtScore(s.score) : '—'),
                custom ? h('button', { class: 'reset-x', title: 'Reset to your real score', onclick: (e) => { e.stopPropagation(); onEdit(s.name, null); } }, '×') : null);
              td.addEventListener('click', () => editScore(td, s, onEdit));
              tr.append(td);
              break;
            }
            case 'pct':
              tr.append(h('td', { class: 'pct' }, pct));
              break;
            case 'rank': {
              const i = c.i;
              const t = (s.rankMaxes || [])[i];
              if (t == null) { tr.append(h('td')); break; }
              const prev = i > 0 ? s.rankMaxes[i - 1] : 0;
              let f = s.score >= t ? 1 : s.score > prev ? (s.score - prev) / (t - prev) : 0;
              if (ts.progress === 'simple' && f < 1) f = 0;
              const fc = ts.rankColumnColors ? shade(rankCol[i]) : fill;
              const first = i === 0, last = i === nThresh - 1;
              tr.append(h('td', { class: 'rc' },
                h('div', { class: 'bar' + (first ? ' first' : '') + (last ? ' last' : ''), style: { left: first ? '12px' : '2px', right: last ? '12px' : '2px' } },
                  h('div', { class: 'track' }, f > 0 ? h('div', { class: 'fill', style: { width: (f * 100).toFixed(1) + '%', background: fc } }) : null)),
                h('span', { class: 'thr' + (f > 0 ? ' on' : ''), style: { color: mixWhite(rankCol[i], thrPct) } }, fmtScore(t))));
              break;
            }
            case 'energy':
              if (k === 0) {
                const en = res.subEnergies[cat.categoryName]?.[subKeys[si]];
                const er = en != null ? res.thresholds.filter((x) => en >= x).length : 0;
                tr.append(h('td', { class: 'energy', rowspan: sub.scenarioCount, style: { color: en ? mixWhite(rankColor(rankEntry(er, b), er), energyPct) : 'var(--muted)' } }, en != null ? fmtScore(en) : '–'));
              }
              break;
          }
        }
        rows.push(tr);
        group.rows.push(tr);
      }
    });
  }
  const cls = ['evx-table', 'd-' + ts.density, ts.shadeCategory ? '' : 'no-shade-cat', ts.shadeRank ? '' : 'no-shade-rank',
    ts.bold ? '' : 'thin', ts.textShadow ? 'shadow' : '', 'font-' + ts.font].filter(Boolean).join(' ');
  const table = h('table', {
    class: cls,
    style: { '--row-h': rowH + 'px', '--skew': ts.skew + 'deg', '--r-out': ts.outerRadius + 'px', '--r-in': ts.innerRadius + 'px', fontSize: (14 * ts.textSize / 100) + 'px' },
  }, thead, h('tbody', null, rows));
  const card = h('div', { class: 'card evx-card' }, table);
  if (ts.subGradient && groups.length) addSubGradients(card, table, groups, ts.gradientStrength);
  return card;
}

/**
 * One gradient block per subcategory, drawn behind the table from the right edge (energy) back to the score column.
 * Positioned from the laid-out rows, so it spans exactly the subcategory's rows whatever the column widths are.
 */
function addSubGradients(card, table, groups, strength) {
  const layer = h('div', { class: 'evx-grads' });
  card.prepend(layer);
  const place = () => {
    const box = card.getBoundingClientRect();
    if (!box.width) return;
    const tb = table.getBoundingClientRect();
    layer.replaceChildren(...groups.map((g) => {
      const first = g.rows[0], last = g.rows[g.rows.length - 1];
      const startCell = first.querySelector('td.score');
      if (!startCell) return null;
      const a = first.getBoundingClientRect(), z = last.getBoundingClientRect(), s = startCell.getBoundingClientRect();
      const left = s.left - box.left + card.scrollLeft, right = tb.right - box.left + card.scrollLeft;
      return h('div', { class: 'evx-grad', style: {
        left: left + 'px', width: Math.max(0, right - left) + 'px', top: (a.top - box.top) + 'px', height: (z.bottom - a.top) + 'px',
        background: `linear-gradient(to left, color-mix(in srgb, ${g.color} ${strength}%, transparent), color-mix(in srgb, ${g.color} ${Math.round(strength * 0.35)}%, transparent) 45%, transparent)`,
      } });
    }));
  };
  new ResizeObserver(place).observe(table);
}

/** Inline what-if editor on a score cell. Enter saves, Escape cancels, empty resets. */
function editScore(td, s, onEdit) {
  if (td.querySelector('input')) return;
  const input = h('input', { class: 'score-input', type: 'number', step: 'any', value: s.score || '' });
  td.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    if (!save) { onEdit(s.name, s.customScore ?? null); return; }
    const v = input.value.trim();
    onEdit(s.name, v === '' ? null : parseFloat(v));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
  input.addEventListener('blur', () => commit(true));
}

function keysOf(subs) {
  const seen = {};
  return subs.map((s, k) => {
    let key = (s.subcategoryName || '').trim() || `#${k + 1}`;
    if (seen[key]) key += ` (${++seen[key]})`; else seen[key] = 1;
    return key;
  });
}
