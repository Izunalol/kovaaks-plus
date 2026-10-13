import { call } from '../rpc.js';
import { h, icon, fmtScore, timeAgo, tagChip, seg, debounce, toast, contextMenu, confirmBox, tagIcon, dropZone, saveMediaFile } from '../ui.js';
import { state, loadLibrary, applyLibrary, displayName, tagById, subscribe, saveConfig, patchScenario } from '../state.js';
import { openScenario } from '../drawer.js';
import { play } from '../play.js';
import { openTagPicker, openTagManager, editTag, tagMenu } from '../tags.js';
import { scenarioThumb } from '../thumbs.js';
import { cardPreview, floatPreview } from '../hover.js';
import { scenarioMenu, bulkMenu } from '../menus.js';
import { openAutoTag } from '../autotag.js';
import { exportItems } from './packs.js';

/** Benchmark id → { name, difficulty, color } for sidebar filters. */
async function loadBenchNames() {
  if (state.benchNames) return;
  try {
    const cat = await call('evxl.catalog');
    const map = {};
    for (const g of cat.groups || []) for (const d of g.difficulties) map[d.id] = { name: g.name, difficulty: d.name, color: g.color };
    state.benchNames = map;
  } catch { state.benchNames = {}; }
}

// Persist filters across navigation within a session.
const ui = (() => {
  try { return JSON.parse(sessionStorage.getItem('lib-ui')) || {}; } catch { return {}; }
})();
ui.tags = ui.tags || [];
ui.quick = ui.quick || 'all';
ui.tagMode = ui.tagMode || 'any';
ui.search = ui.search || '';
ui.source = ui.source || 'any';
ui.bench = ui.bench || null;
let lastTagClicked = null;
const persist = () => { try { sessionStorage.setItem('lib-ui', JSON.stringify(ui)); } catch { } };

const QUICK = [
  { id: 'all', label: 'All scenarios', icon: 'layers' },
  { id: 'fav', label: 'Favorites', icon: 'star' },
  { id: 'recent', label: 'Played this week', icon: 'clock' },
  { id: 'never', label: 'Never played', icon: 'target' },
  { id: 'untagged', label: 'Untagged', icon: 'tag' },
  { id: 'bench', label: 'In a benchmark', icon: 'trophy' },
  { id: 'hidden', label: 'Hidden', icon: 'eyeOff' },
];

const SORTS = [
  ['recent', 'Recently played'], ['name', 'Name (A–Z)'], ['plays', 'Most played'], ['pb', 'Recent PBs'], ['added', 'First played'],
  ['tag', 'Tag (A–Z)'], ['tagorder', 'Tag (panel order)'],
];

export async function render(page, arg, params) {
  page.classList.add('page-wide');
  if (params.fav) ui.quick = 'fav';
  if (params.bench) { ui.bench = +params.bench; ui.quick = 'all'; }
  if (params.tag) { ui.tags = [params.tag]; ui.quick = 'all'; }
  const selected = new Set();
  let selecting = false;
  let visible = [];
  let lastShown = 0;     // cards rendered so far (kept when redrawing in place)
  let lastClicked = null;
  let rankCache = null;   // tag id → panel position, rebuilt on each compute()

  const search = h('input', { class: 'input', placeholder: 'Search name, author, tag…', value: ui.search });
  const sortSel = h('select', { class: 'input' }, SORTS.map(([v, l]) => h('option', { value: v, selected: v === state.config.librarySort }, l)));
  const countEl = h('span', { class: 'result-count' });
  const filters = h('div', { class: 'filters' });
  const content = h('div');
  const bulk = h('div', { class: 'bulk-bar hidden' });

  page.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Scenarios'), h('div', { class: 'sub' }, 'Custom names and tags live in Kovaak\'s Plus, so your scenario files stay untouched and keep working in KovaaK\'s.')),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => openAutoTag({ filtered: visible.map((s) => s.name), selected: [...selected] }) }, icon('tag'), 'Auto-tag'),
      h('button', { class: 'btn', onclick: () => { selecting = !selecting; if (!selecting) selected.clear(); draw(); } }, icon('check'), 'Select'),
      h('button', { class: 'btn ghost icon', title: 'More', onclick: (e) => contextMenu(e, [
        { label: 'Auto-tag scenarios…', icon: 'tag', onClick: () => openAutoTag({ filtered: visible.map((s) => s.name), selected: [...selected] }) },
        { label: 'Manage tags…', icon: 'edit', onClick: openTagManager },
        { label: 'Import favorites from KovaaK\'s', icon: 'star', onClick: importFavorites },
        { sep: true },
        { label: 'Rescan scenario folders', icon: 'refresh', onClick: rescan },
      ]) }, icon('settings'))),
    h('div', { class: 'lib-layout' },
      filters,
      h('div', null,
        h('div', { class: 'toolbar' },
          h('div', { class: 'search' }, icon('search'), search),
          sortSel,
          seg([{ value: 'grid', icon: 'grid', title: 'Grid' }, { value: 'list', icon: 'list', title: 'List' }], state.config.libraryView || 'grid', (v) => {
            // Update locally first so the redraw doesn't wait for the save round-trip.
            state.config.libraryView = v;
            drawContent();
            saveConfig({ libraryView: v });
          }),
          h('div', { class: 'grow' }), countEl),
        content, bulk)));

  search.addEventListener('input', debounce(() => { ui.search = search.value; persist(); drawContent(); }, 120));
  sortSel.addEventListener('change', () => { state.config.librarySort = sortSel.value; drawContent(); saveConfig({ librarySort: sortSel.value }); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; ui.search = ''; drawContent(); } });

  content.append(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto 10px' } }), 'Loading your library…'));
  try { await loadLibrary(); } catch (e) { content.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Couldn\'t load scenarios'), e.message)); return; }
  if ((state.config.benchmarkFilters || []).length || ui.bench) await loadBenchNames();

  // Library changes (rename, tag, new run) redraw in place, keeping the scroll position and loaded cards.
  const unsub = subscribe('library', () => { const top = document.getElementById('view').scrollTop; drawFilters(); drawContent(true); document.getElementById('view').scrollTop = top; });
  draw();
  setTimeout(() => search.focus(), 50);

  async function importFavorites() {
    try {
      const favs = await call('library.gameFavorites');
      if (!favs.length) { toast('No favorites found in KovaaK\'s'); return; }
      if (!await confirmBox('Import favorites?', `Mark ${favs.length} scenario${favs.length === 1 ? '' : 's'} you favorited inside KovaaK's as favorites here?`, 'Import')) return;
      const r = await call('library.importGameFavorites');
      applyLibrary(await call('library.list'));
      toast(`Imported ${r.imported} favorites`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function rescan() {
    content.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto' } })));
    try { applyLibrary(await call('library.rescan')); toast(`Library rescanned: ${state.scenarios.length.toLocaleString()} scenarios`, 'ok'); }
    catch (e) { toast(e.message, 'error'); }
    draw();   // redraw directly; don't rely on the change notification alone
  }

  function draw() { drawFilters(); drawContent(); }

  function baseFilter(s) {
    if (ui.quick !== 'hidden' && s.hidden) return false;
    switch (ui.quick) {
      case 'fav': return s.favorite;
      case 'recent': return s.lastPlayed && Date.now() - new Date(s.lastPlayed) < 7 * 86400000;
      case 'never': return !s.plays;
      case 'untagged': return !s.tags.length;
      case 'bench': return s.benchmarks && s.benchmarks.length;
      case 'hidden': return s.hidden;
    }
    return true;
  }

  function sourceFilter(s) {
    if (ui.source === 'local') return s.installed && s.source === 'local';
    if (ui.source === 'workshop') return s.source === 'workshop';
    if (ui.source === 'missing') return !s.installed;
    return state.config.showUninstalled !== false || s.installed;
  }

  function drawFilters() {
    const base = state.scenarios.filter((s) => sourceFilter(s));
    const quickCount = (id) => { const q = ui.quick; ui.quick = id; const n = base.filter(baseFilter).length; ui.quick = q; return n; };
    const pool = base.filter(baseFilter);
    const tagCounts = new Map();
    pool.forEach((s) => s.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));

    const groups = [...state.groups];
    state.tags.forEach((t) => { if (!groups.includes(t.group)) groups.push(t.group); });

    filters.replaceChildren(
      h('div', { class: 'filter-group' }, h('div', { class: 'filter-list' }, QUICK.map((q) =>
        h('div', { class: 'filter-item' + (ui.quick === q.id ? ' on' : ''), onclick: () => { ui.quick = q.id; persist(); draw(); } },
          icon(q.icon), q.label, h('span', { class: 'count' }, quickCount(q.id).toLocaleString()))))),
      ...groups.map((g) => {
        const tags = state.tags.filter((t) => t.group === g);
        if (!tags.length) return null;
        return h('div', { class: 'filter-group' },
          h('h4', null, g, h('span', { class: 'spacer' }), g === groups.find((x) => state.tags.some((t) => t.group === x)) ? h('span', { class: 'row', style: { gap: '4px' } },
            h('button', { class: 'btn ghost sm', style: { height: '22px', padding: '0 6px', fontSize: '11px' }, title: 'Match any / all selected tags', onclick: () => { ui.tagMode = ui.tagMode === 'any' ? 'all' : 'any'; persist(); draw(); } }, ui.tagMode === 'any' ? 'Match any' : 'Match all')) : null),
          h('div', { class: 'filter-list' }, tags.map((t) => h('div', {
            class: 'filter-item tag-filter' + (ui.tags.includes(t.id) ? ' on' : ''), '--c': t.color, title: 'Click to filter · Ctrl+click to add · Shift+click for a range · Right-click to edit',
            onclick: (e) => { selectTag(t, e); persist(); draw(); },
            oncontextmenu: (e) => tagMenu(e, t, [
              { label: 'Show only this tag', icon: 'search', onClick: () => { ui.tags = [t.id]; ui.quick = 'all'; persist(); draw(); } },
              { label: 'Select its scenarios', icon: 'check', onClick: () => { selecting = true; state.scenarios.filter((s) => s.tags.includes(t.id)).forEach((s) => selected.add(s.name)); drawContent(); } },
            ]),
          }, tagIcon(t),
            h('span', { class: 'ellipsis' }, t.name),
            h('button', { class: 'tag-edit', title: 'Edit tag', onclick: (e) => { e.stopPropagation(); editTag(t); } }, icon('edit')),
            h('span', { class: 'count' }, tagCounts.get(t.id) || 0)))));
      }),
      benchFilterGroup(base),
      h('div', { class: 'filter-group' }, h('h4', null, 'Source'), h('div', { class: 'filter-list' },
        [['any', 'Everything'], ['local', 'Local files'], ['workshop', 'Steam Workshop'], ['missing', 'Played, not installed']].map(([v, l]) =>
          h('div', { class: 'filter-item' + (ui.source === v ? ' on' : ''), onclick: () => { ui.source = v; persist(); draw(); } }, l)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: openTagManager }, icon('tag'), 'Manage tags'),
        ui.tags.length ? h('button', { class: 'btn ghost sm', onclick: () => { ui.tags = []; persist(); draw(); } }, 'Clear tags') : null),
    );
  }

  /** Panel order of all tags (groups in panel order, tags in list order). */
  function panelOrder() {
    const groups = [...state.groups];
    state.tags.forEach((t) => { if (!groups.includes(t.group)) groups.push(t.group); });
    return groups.flatMap((g) => state.tags.filter((t) => t.group === g));
  }

  /** Click = only this tag (click again to clear), Ctrl+click = add/remove, Shift+click = range in panel order. */
  function selectTag(t, e) {
    if (e.ctrlKey || e.metaKey) ui.tags = ui.tags.includes(t.id) ? ui.tags.filter((x) => x !== t.id) : [...ui.tags, t.id];
    else if (e.shiftKey && lastTagClicked) {
      const order = panelOrder().map((x) => x.id);
      const a = order.indexOf(lastTagClicked), b = order.indexOf(t.id);
      if (a >= 0 && b >= 0) ui.tags = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      else ui.tags = [t.id];
    } else ui.tags = ui.tags.length === 1 && ui.tags[0] === t.id ? [] : [t.id];
    if (!e.shiftKey) lastTagClicked = t.id;
  }

  /** Benchmarks you've chosen to show as filters (Benchmark page → ⋯ → Show as scenario filter). */
  function benchFilterGroup(base) {
    const ids = state.config.benchmarkFilters || [];
    if (!ids.length) return null;
    return h('div', { class: 'filter-group' }, h('h4', null, 'Benchmarks'), h('div', { class: 'filter-list' }, ids.map((id) => {
      const info = (state.benchNames || {})[id] || { name: `Benchmark ${id}` };
      const count = base.filter((s) => s.benchmarks && s.benchmarks.includes(id)).length;
      return h('div', {
        class: 'filter-item tag-filter' + (ui.bench === id ? ' on' : ''), title: 'Filter by this benchmark · arrow opens its page',
        onclick: () => { ui.bench = ui.bench === id ? null : id; persist(); draw(); },
        oncontextmenu: (e) => contextMenu(e, [
          { header: info.name },
          { label: 'Open benchmark page', icon: 'trophy', onClick: () => (location.hash = '#/benchmarks/' + id) },
          { label: 'Remove from filters', icon: 'x', onClick: () => saveConfig({ benchmarkFilters: ids.filter((x) => x !== id) }).then(draw) },
        ]),
      }, h('span', { class: 'tag-ico', style: { color: info.color || '#eab308' } }, icon('trophy')),
        h('span', { class: 'ellipsis' }, info.name, info.difficulty ? h('span', { class: 'muted' }, ' · ' + info.difficulty) : null),
        h('button', { class: 'tag-edit', title: 'Open benchmark page', onclick: (e) => { e.stopPropagation(); location.hash = '#/benchmarks/' + id; } }, icon('external')),
        h('span', { class: 'count' }, count));
    })));
  }

  function compute() {
    const q = ui.search.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    rankCache = null;
    let list = state.scenarios.filter((s) => sourceFilter(s) && baseFilter(s));
    if (ui.bench) list = list.filter((s) => s.benchmarks && s.benchmarks.includes(ui.bench));
    if (ui.tags.length) {
      list = list.filter((s) => ui.tagMode === 'all' ? ui.tags.every((t) => s.tags.includes(t)) : ui.tags.some((t) => s.tags.includes(t)));
    }
    if (terms.length) {
      list = list.filter((s) => {
        const hay = [s.name, s.customName, s.author, ...s.tags.map((id) => tagById(id)?.name)].filter(Boolean).join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const by = sortSel.value;
    const time = (d) => (d ? new Date(d).getTime() : 0);
    const cmp = {
      recent: (a, b) => time(b.lastPlayed) - time(a.lastPlayed) || displayName(a).localeCompare(displayName(b)),
      name: (a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true, sensitivity: 'base' }),
      plays: (a, b) => b.plays - a.plays,
      pb: (a, b) => time(b.pbDate) - time(a.pbDate),
      added: (a, b) => time(b.firstPlayed) - time(a.firstPlayed),
      tag: (a, b) => cmpKey(tagKeyAZ(a), tagKeyAZ(b)) || displayName(a).localeCompare(displayName(b)),
      tagorder: (a, b) => tagRank(a) - tagRank(b) || displayName(a).localeCompare(displayName(b)),
    }[by] || ((a, b) => displayName(a).localeCompare(displayName(b)));
    return list.sort(cmp);
  }

  // Tag sorting: a scenario is grouped under its "primary" tag (alphabetically first, or first in panel order).
  function cmpKey(a, b) { return a === b ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b, undefined, { sensitivity: 'base' }); }
  function tagKeyAZ(s) {
    const names = s.tags.map((id) => tagById(id)?.name).filter(Boolean).sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
    return names[0] ?? null;
  }
  function tagRank(s) {
    if (!rankCache) rankCache = new Map(panelOrder().map((t, i) => [t.id, i]));
    const r = s.tags.map((id) => rankCache.get(id)).filter((x) => x != null);
    return r.length ? Math.min(...r) : 1e9;
  }
  /** Section heading for tag sorts: the scenario's primary tag (or null = untagged). */
  function sectionOf(s) {
    const by = sortSel.value;
    if (by === 'tag') { const n = tagKeyAZ(s); return n ? state.tags.find((t) => t.name === n) : null; }
    if (by === 'tagorder') { const r = tagRank(s); return r < 1e9 ? panelOrder()[r] : null; }
    return undefined;
  }

  /** Every filter currently narrowing the list, each with a way to clear it. */
  function activeFilters() {
    const list = [];
    const q = QUICK.find((x) => x.id === ui.quick);
    if (ui.quick !== 'all' && q) list.push({ label: q.label, clear: () => { ui.quick = 'all'; } });
    for (const id of ui.tags) {
      const t = tagById(id);
      list.push({ label: t ? `Tag: ${t.name}` : 'Missing tag', color: t && t.color, clear: () => { ui.tags = ui.tags.filter((x) => x !== id); } });
    }
    if (ui.tags.length > 1) list.push({ label: ui.tagMode === 'all' ? 'Match all tags' : 'Match any tag', clear: () => { ui.tagMode = 'any'; } });
    if (ui.source !== 'any') list.push({ label: { local: 'Local files', workshop: 'Steam Workshop', missing: 'Played, not installed' }[ui.source], clear: () => { ui.source = 'any'; } });
    if (ui.search.trim()) list.push({ label: `Search: "${ui.search.trim()}"`, clear: () => { ui.search = ''; search.value = ''; } });
    if (ui.bench) { const b = (state.benchNames || {})[ui.bench]; list.push({ label: `Benchmark: ${b ? b.name + (b.difficulty ? ' ' + b.difficulty : '') : ui.bench}`, color: '#eab308', clear: () => { ui.bench = null; } }); }
    return list;
  }

  function resetFilters() {
    Object.assign(ui, { quick: 'all', tags: [], tagMode: 'any', source: 'any', search: '', bench: null });
    search.value = '';
    persist();
    draw();
  }

  function drawContent(preserve = false) {
    const keep = preserve ? lastShown : 0;
    visible = compute();
    countEl.textContent = `${visible.length.toLocaleString()} scenario${visible.length === 1 ? '' : 's'}`;
    content.replaceChildren();
    content.classList.toggle('selecting', selecting);
    const filters = activeFilters();
    if (filters.length) {
      content.append(h('div', { class: 'filter-bar' }, h('span', { class: 'small muted' }, 'Filtered by'),
        ...filters.map((f) => h('span', { class: 'chip btnlike', '--c': f.color || '#64748b', onclick: () => { f.clear(); persist(); draw(); } }, f.label, h('span', { class: 'x' }, '×'))),
        h('button', { class: 'btn ghost sm', onclick: resetFilters }, 'Clear all')));
    }
    if (!visible.length) {
      const total = state.scenarios.length;
      content.append(h('div', { class: 'card empty', style: { padding: '40px 20px' } }, icon('search'),
        h('b', null, total ? 'No scenarios match these filters' : 'No scenarios found'),
        h('div', { style: { marginBottom: '14px' } }, total
          ? `You have ${total.toLocaleString()} scenarios, but the filters above hide all of them.`
          : 'Kovaak\'s Plus couldn\'t find any scenario files. Check the KovaaK\'s folder in App Settings, then rescan.'),
        total ? h('button', { class: 'btn primary', onclick: resetFilters }, 'Show all scenarios')
          : h('button', { class: 'btn primary', onclick: rescan }, icon('refresh'), 'Rescan')));
      drawBulk();
      return;
    }
    if (ui.bench) {
      const b = (state.benchNames || {})[ui.bench];
      content.append(h('div', { class: 'card bench-banner', onclick: () => (location.hash = '#/benchmarks/' + ui.bench) },
        icon('trophy'), h('div', { class: 'grow' }, h('b', null, b ? b.name : 'Benchmark'), b && b.difficulty ? h('span', { class: 'muted' }, ' · ' + b.difficulty) : null,
          h('div', { class: 'small muted' }, `${visible.length} scenarios in this benchmark`)),
        h('button', { class: 'btn sm primary' }, 'Open benchmark page', icon('arrowLeft', 'flip-x'))));
    }
    const isList = (state.config.libraryView || 'grid') === 'list';
    const container = h('div', { class: isList ? 'scen-list' : 'scen-grid' });
    // Tag sorts get a heading per primary tag.
    const sectionCounts = new Map();
    if (sectionOf(visible[0]) !== undefined) visible.forEach((s) => { const k = sectionOf(s)?.id ?? '__none'; sectionCounts.set(k, (sectionCounts.get(k) || 0) + 1); });
    let lastSection = Symbol('start');
    if (isList) container.append(h('div', { class: 'scen-row head' }, h('span'), h('span', null, 'Scenario'), h('span', null, 'Tags'), h('span', { style: { textAlign: 'right' } }, 'PB'), h('span', { style: { textAlign: 'right' } }, 'Plays'), h('span', null, 'Last played'), h('span')));
    content.append(container);

    let shown = 0;
    const PAGE = 120;
    const sentinel = h('div', { style: { height: '1px' } });
    const more = (count = PAGE) => {
      const next = visible.slice(shown, shown + count);
      next.forEach((s) => {
        if (sectionCounts.size) {
          const sec = sectionOf(s);
          const key = sec ? sec.id : '__none';
          if (key !== lastSection) {
            lastSection = key;
            container.append(h('div', { class: 'scen-section' }, sec ? tagIcon(sec) : null, h('b', null, sec ? sec.name : 'Untagged'),
              sec ? h('span', { class: 'muted small' }, sec.group) : null, h('span', { class: 'count' }, sectionCounts.get(key) || 0)));
          }
        }
        container.append(isList ? row(s) : card(s));
      });
      shown += next.length;
      lastShown = shown;
      if (shown >= visible.length) io.disconnect();
    };
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) more(); }, { root: document.getElementById('view'), rootMargin: '800px' });
    content.append(sentinel);
    more(Math.max(PAGE, keep));
    io.observe(sentinel);
    drawBulk();
  }

  function onClick(e, s, el) {
    if (selecting || e.ctrlKey || e.shiftKey) {
      if (!selecting) { selecting = true; content.classList.add('selecting'); }
      if (e.shiftKey && lastClicked) {
        const a = visible.indexOf(lastClicked), b = visible.indexOf(s);
        visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => selected.add(x.name));
        drawContent();
      } else {
        selected.has(s.name) ? selected.delete(s.name) : selected.add(s.name);
        el.classList.toggle('selected', selected.has(s.name));
      }
      lastClicked = s;
      drawBulk();
      return;
    }
    openScenario(s.name);
  }

  function onMenu(e, s) {
    if (selecting && selected.size > 1 && selected.has(s.name)) bulkMenu(e, [...selected], () => drawContent(true));
    else scenarioMenu(e, s.name);
  }

  function card(s) {
    const th = scenarioThumb(s);
    th.append(
      h('div', { class: 'corner' },
        s.favorite ? h('span', { class: 'badge', style: { background: 'rgba(0,0,0,.55)', color: 'var(--gold)' } }, '★') : null,
        s.benchmarks && s.benchmarks.length ? h('span', { class: 'badge', style: { background: 'rgba(0,0,0,.55)', color: '#fde68a' }, title: 'Part of a benchmark' }, icon('trophy')) : null,
        !s.installed ? h('span', { class: 'badge', style: { background: 'rgba(0,0,0,.55)' }, title: 'Not installed locally' }, 'Online') : null),
      h('span', { class: 'sel-box' }),
      h('button', { class: 'play-fab', title: 'Play', onclick: (e) => { e.stopPropagation(); play(s.name, null, { queue: visible.map((x) => x.name) }); } }, icon('play')));
    th.querySelectorAll('.badge svg').forEach((x) => { x.style.width = '12px'; x.style.height = '12px'; });
    const el = h('div', { class: 'scen-card' + (selected.has(s.name) ? ' selected' : ''), title: s.customName ? s.name : '' },
      th,
      h('div', { class: 'scen-body' },
        h('div', { class: 'scen-name' }, displayName(s)),
        s.customName ? h('div', { class: 'scen-orig' }, s.name) : null,
        s.tags.length ? h('div', { class: 'chips' }, s.tags.slice(0, 3).map((id) => tagById(id)).filter(Boolean).map((t) => tagChip(t, { sm: true })), s.tags.length > 3 ? h('span', { class: 'chip sm off' }, '+' + (s.tags.length - 3)) : null) : null,
        h('div', { class: 'scen-meta' }, h('span', null, 'PB ', h('b', null, fmtScore(s.pb))), h('span', null, h('b', null, s.plays), ' plays'), h('span', { class: 'grow', style: { textAlign: 'right' } }, s.lastPlayed ? timeAgo(s.lastPlayed) : ''))));
    el.addEventListener('click', (e) => onClick(e, s, el));
    el.addEventListener('contextmenu', (e) => onMenu(e, s));
    cardPreview(el, th, s);
    // Drop an image (or GIF/clip) onto a card to make it the thumbnail.
    dropZone(el, async (file) => {
      try {
        const media = await saveMediaFile(file, 'scenario:' + s.name, 'thumbnail');
        const res = await call('library.setMeta', { name: s.name, thumbnail: media });
        patchScenario(s.name, res.meta);
        toast('Thumbnail updated', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    }, 'media');
    return el;
  }

  function row(s) {
    const el = h('div', { class: 'scen-row' + (selected.has(s.name) ? ' selected' : '') },
      scenarioThumb(s),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, s.favorite ? h('span', { class: 'fav-star' }, '★ ') : null, displayName(s)), s.customName ? h('div', { class: 'scen-orig' }, s.name) : (s.author ? h('div', { class: 'scen-orig' }, 'by ' + s.author) : null)),
      h('div', { class: 'chips', style: { overflow: 'hidden', flexWrap: 'nowrap' } }, s.tags.map((id) => tagById(id)).filter(Boolean).map((t) => tagChip(t, { sm: true }))),
      h('div', { class: 'num', style: { textAlign: 'right', fontWeight: 600 } }, fmtScore(s.pb)),
      h('div', { class: 'num muted', style: { textAlign: 'right' } }, s.plays),
      h('div', { class: 'muted small' }, s.lastPlayed ? timeAgo(s.lastPlayed) : 'never'),
      h('div', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); play(s.name, null, { queue: visible.map((x) => x.name) }); } }, icon('play'), 'Play')));
    el.addEventListener('click', (e) => onClick(e, s, el));
    el.addEventListener('contextmenu', (e) => onMenu(e, s));
    floatPreview(el, s.name);
    return el;
  }

  function drawBulk() {
    bulk.classList.toggle('hidden', !selecting);
    if (!selecting) return;
    const names = [...selected];
    const n = names.length;
    const run = async (params, msg) => {
      try { await call('library.bulk', { names, ...params }); applyLibrary(await call('library.list')); toast(msg, 'ok'); } catch (e) { toast(e.message, 'error'); }
    };
    bulk.replaceChildren(
      h('b', null, `${n} selected`),
      h('button', { class: 'btn ghost sm', onclick: () => { visible.forEach((s) => selected.add(s.name)); drawContent(); } }, 'Select all ' + visible.length),
      h('div', { style: { width: '1px', height: '22px', background: 'var(--border-2)' } }),
      h('button', { class: 'btn sm', disabled: !n, onclick: () => openTagPicker(`Add tags to ${n} scenarios`, [], (ids) => run({ addTags: ids }, 'Tags added')) }, icon('tag'), 'Add tags'),
      h('button', { class: 'btn sm', disabled: !n, onclick: () => openTagPicker(`Remove tags from ${n} scenarios`, [], (ids) => run({ removeTags: ids }, 'Tags removed')) }, 'Remove tags'),
      h('button', { class: 'btn sm', disabled: !n, onclick: () => run({ favorite: true }, 'Added to favorites') }, icon('star'), 'Favorite'),
      h('button', { class: 'btn sm', disabled: !n, onclick: () => run({ hidden: ui.quick !== 'hidden' }, ui.quick === 'hidden' ? 'Unhidden' : 'Hidden') }, icon(ui.quick === 'hidden' ? 'eye' : 'eyeOff'), ui.quick === 'hidden' ? 'Unhide' : 'Hide'),
      h('button', { class: 'btn sm', disabled: !n, onclick: () => exportItems({ scenarios: names, name: `${n} scenarios` }) }, icon('download'), 'Export pack'),
      h('button', { class: 'btn ghost sm icon', title: 'Done', onclick: () => { selecting = false; selected.clear(); drawContent(); } }, icon('x')));
  }

  return () => unsub();
}
