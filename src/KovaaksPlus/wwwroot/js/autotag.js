// Auto-tag wizard: scan sources → review proposals (reuse an existing tag or create a new one) → apply.
import { call } from './rpc.js';
import { h, icon, modal, toast, tagChip } from './ui.js';
import { state, applyLibrary, tagById } from './state.js';

const SOURCE_LABEL = { skills: 'Aim type', gametag: 'In-game tag', difficulty: 'Difficulty', benchmark: 'Benchmark' };
const COLORS = ['#f97316', '#22d3ee', '#a3e635', '#e879f9', '#38bdf8', '#facc15', '#f472b6', '#2dd4bf', '#818cf8', '#fb7185'];

/** scopes: { all: true, filtered: [names], selected: [names] } */
export function openAutoTag(scopes = {}) {
  let scope = scopes.selected && scopes.selected.length ? 'selected' : 'all';
  const sources = new Set(['skills', 'gametag']);
  let minCount = 3;
  const body = h('div', { class: 'col', style: { gap: '16px' } });
  let m;

  const drawSetup = () => {
    const opt = (key, label, hint) => h('label', { class: 'row filter-item', style: { padding: '9px 10px', alignItems: 'flex-start' } },
      h('input', { type: 'checkbox', checked: sources.has(key), onchange: (e) => { e.target.checked ? sources.add(key) : sources.delete(key); } }),
      h('div', null, h('div', { style: { color: 'var(--text)', fontWeight: 600 } }, label), h('div', { class: 'small muted' }, hint)));
    const scopeBtn = (v, label) => h('button', { class: 'btn sm' + (scope === v ? ' primary' : ''), onclick: () => { scope = v; drawSetup(); } }, label);
    const min = h('input', { class: 'input', type: 'number', min: 1, value: minCount, style: { width: '80px' } });
    min.addEventListener('change', () => { minCount = Math.max(1, parseInt(min.value, 10) || 1); });
    body.replaceChildren(
      h('div', { class: 'muted' }, 'Kovaak\'s Plus proposes tags from the sources below. You review every proposal first: where a similar tag already exists, you choose whether to use it or create a new one.'),
      h('div', { class: 'col', style: { gap: '6px' } }, h('div', { class: 'small', style: { fontWeight: 700, color: 'var(--text-2)' } }, 'Which scenarios'),
        h('div', { class: 'row wrap' }, scopeBtn('all', 'All scenarios'),
          scopes.filtered ? scopeBtn('filtered', `Currently shown (${scopes.filtered.length})`) : null,
          scopes.selected && scopes.selected.length ? scopeBtn('selected', `Selected (${scopes.selected.length})`) : null)),
      h('div', { class: 'col', style: { gap: '2px' } }, h('div', { class: 'small', style: { fontWeight: 700, color: 'var(--text-2)' } }, 'Sources'),
        opt('skills', 'Aim type (evxl.app classification)', 'Dynamic Clicking, Reactive Tracking, Speed Switching… for ~2,000 popular scenarios'),
        opt('gametag', 'In-game scenario tags', 'The tags authors put in the scenario file (e.g. "Flick", "Overwatch", "Track"). Synonyms like Track/Tracking or OW/Overwatch are merged'),
        opt('difficulty', 'In-game difficulty (1–5)', 'Suggests your Easy / Medium / Hard / Extreme tags'),
        opt('benchmark', 'Benchmark scenarios', 'Adds "Benchmark" to scenarios that appear in any benchmark')),
      h('div', { class: 'row' }, h('span', { class: 'small', style: { fontWeight: 700, color: 'var(--text-2)' } }, 'Ignore in-game tags used by fewer than'), min, h('span', { class: 'small muted' }, 'scenarios')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: scan }, icon('search'), 'Find tags')));
  };

  const scan = async () => {
    if (!sources.size) { toast('Pick at least one source'); return false; }
    body.replaceChildren(h('div', { class: 'row muted' }, h('div', { class: 'spinner' }), 'Scanning scenarios…'));
    const names = scope === 'selected' ? scopes.selected : scope === 'filtered' ? scopes.filtered : null;
    try {
      const cands = await call('library.autoTagScan', { names, sources: [...sources], minCount });
      review(cands);
    } catch (e) { toast(e.message, 'error'); drawSetup(); }
  };

  function review(cands) {
    // decision per candidate: { action: 'use'|'create'|'skip'|null, tagId, name, group }
    // Defaults: exact matches reuse the tag; similar matches must be decided; new aim types are created;
    // unmatched in-game tags (often game names) start unchecked so the library isn't flooded.
    const dec = new Map(cands.map((c, i) => [c.key, {
      action: c.matchKind === 'exact' ? 'use' : c.matchKind ? null : (c.source === 'skills' || c.source === 'benchmark' ? 'create' : 'skip'),
      tagId: c.matchTagId, name: c.name, group: c.group, color: COLORS[i % COLORS.length],
    }]));
    const list = h('div', { class: 'col', style: { gap: '4px', maxHeight: '52vh', overflow: 'auto' } });
    const summary = h('div', { class: 'small muted' });

    const draw = () => {
      list.replaceChildren(...cands.map((c) => row(c)));
      const pending = cands.filter((c) => !dec.get(c.key).action).length;
      const use = cands.filter((c) => dec.get(c.key).action === 'use').length;
      const create = cands.filter((c) => dec.get(c.key).action === 'create').length;
      summary.replaceChildren(pending ? h('span', { style: { color: 'var(--gold)' } }, `${pending} need a decision · `) : null, `${use} use existing · ${create} new tags · ${cands.length - use - create - pending} skipped`);
      applyBtn.disabled = pending > 0;
    };

    const row = (c) => {
      const d = dec.get(c.key);
      const existing = d.tagId ? tagById(d.tagId) : null;
      const btn = (action, label, extraClass = '') => h('button', { class: 'btn sm ' + extraClass + (d.action === action ? ' on' : ''), onclick: () => { d.action = action; draw(); } }, label);
      const similarPick = c.similar && c.similar.length > 1
        ? h('select', { class: 'input', style: { height: '30px', width: '160px' }, onchange: (e) => { d.tagId = e.target.value; d.action = 'use'; draw(); } },
          c.similar.map((id) => h('option', { value: id, selected: id === d.tagId }, tagById(id)?.name || id)))
        : null;
      const nameIn = h('input', { class: 'input', value: d.name, style: { height: '30px', width: '150px' } });
      nameIn.addEventListener('change', () => { d.name = nameIn.value.trim() || c.name; });
      return h('div', { class: 'at-row' + (!d.action ? ' ask' : '') },
        h('input', { type: 'checkbox', checked: d.action !== 'skip', onchange: (e) => { d.action = e.target.checked ? (existing ? 'use' : 'create') : 'skip'; draw(); } }),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'ellipsis', style: { color: 'var(--text)', fontWeight: 600 } }, c.name),
          h('div', { class: 'src' }, SOURCE_LABEL[c.source] || c.source, c.variants && c.variants.length > 1 ? h('span', { style: { textTransform: 'none', letterSpacing: 0, fontWeight: 500 } }, ' · also ' + c.variants.filter((v) => v !== c.name).slice(0, 3).join(', ')) : null)),
        h('div', { class: 'small muted', title: c.names.slice(0, 25).join('\n') + (c.names.length > 25 ? '\n…' : '') }, `${c.count} scenario${c.count === 1 ? '' : 's'}`),
        h('div', { class: 'at-choice' },
          c.matchKind === 'exact'
            ? h('span', { class: 'small muted row' }, 'Existing tag ', existing ? tagChip(existing, { sm: true }) : null)
            : [
              !d.action && existing ? h('span', { class: 'small', style: { color: 'var(--gold)' } }, c.matchKind === 'suggested' ? 'Map to' : 'Similar to') : null,
              existing ? btn('use', h('span', { class: 'row', style: { gap: '6px' } }, 'Use ', tagChip(existing, { sm: true }))) : null,
              similarPick,
              btn('create', 'Create new'),
              d.action === 'create' ? nameIn : null,
              btn('skip', 'Skip', 'ghost'),
            ]));
    };

    const bulk = h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: () => { cands.forEach((c) => { const d = dec.get(c.key); if (!d.action && d.tagId) d.action = 'use'; }); draw(); } }, 'Use suggested tag for all similar'),
      h('button', { class: 'btn sm', onclick: () => { cands.forEach((c) => { const d = dec.get(c.key); if (!d.action) d.action = 'create'; }); draw(); } }, 'Create new for all undecided'),
      h('button', { class: 'btn sm ghost', onclick: () => { cands.forEach((c) => { const d = dec.get(c.key); if (!d.action) d.action = 'skip'; }); draw(); } }, 'Skip undecided'));

    const applyBtn = h('button', { class: 'btn primary', onclick: apply }, icon('check'), 'Apply tags');
    async function apply() {
      const items = cands.map((c) => ({ c, d: dec.get(c.key) })).filter(({ d }) => d.action === 'use' || d.action === 'create')
        .map(({ c, d }) => d.action === 'use' ? { names: c.names, tagId: d.tagId } : { names: c.names, create: { name: d.name, group: d.group, color: d.color } });
      if (!items.length) { toast('Nothing to apply'); return; }
      try {
        const r = await call('library.autoTagApply', { items });
        applyLibrary(await call('library.list'));
        toast(`Tagged: ${r.assigned} tag assignments, ${r.created} new tag${r.created === 1 ? '' : 's'}`, 'ok');
        m.close();
      } catch (e) { toast(e.message, 'error'); }
    }

    body.replaceChildren(
      cands.length ? h('div', { class: 'muted small' }, 'Highlighted rows matched a tag you already have. Choose whether to use it or create a new tag.') : h('div', { class: 'empty' }, 'No tag proposals for these scenarios. Try more sources or a lower minimum.'),
      cands.length ? bulk : null, list,
      h('div', { class: 'row' }, summary, h('div', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: drawSetup }, 'Back'), cands.length ? applyBtn : null));
    draw();
  }

  drawSetup();
  m = modal({ title: 'Auto-tag scenarios', wide: true, body });
}
