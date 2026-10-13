import { call } from '../rpc.js';
import { h, icon, toast, modal, tagChip, toggle, debounce, fileToDataUrl } from '../ui.js';
import { state, loadLibrary, applyLibrary, displayName, tagById } from '../state.js';

/** Export dialog used everywhere (single scenario, bulk selection, single preset, pack builder). */
export function exportItems({ scenarios = [], presets = [], name = 'My pack' }) {
  const nameIn = h('input', { class: 'input', value: name });
  const author = h('input', { class: 'input', value: state.config.steamName || '' });
  const desc = h('textarea', { class: 'input', placeholder: 'What\'s in this pack? (shown to whoever imports it)', style: { minHeight: '70px' } });
  const parts = [];
  if (scenarios.length) parts.push(`${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}`);
  if (presets.length) parts.push(`${presets.length} preset${presets.length === 1 ? '' : 's'}`);
  modal({
    title: 'Export pack',
    body: h('div', { class: 'col', style: { gap: '14px' } },
      h('div', { class: 'muted' }, `Includes ${parts.join(' and ')}, plus custom names, tags, notes, thumbnails and previews. Friends import it with Kovaak's Plus → Import / Export (or by dropping the file onto the window).`),
      h('label', { class: 'field' }, 'Pack name', nameIn), h('label', { class: 'field' }, 'Author', author), h('label', { class: 'field' }, 'Description', desc)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Save .kpack…', kind: 'primary', onClick: async () => {
        try {
          const res = await call('packs.export', { name: nameIn.value.trim() || 'Pack', author: author.value.trim() || null, description: desc.value.trim() || null, scenarios, presets });
          if (!res) return false;
          toast(`Exported ${res.scenarios} scenario(s) and ${res.presets} preset(s)`, 'ok');
          call('app.revealFile', { path: res.path });
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    }],
  });
}

/** Import flow: preview contents, choose items, install. */
export async function importPack(preview) {
  if (!preview) return;
  const selS = new Set(preview.scenarios.filter((s) => !s.identical || s.tags.length || s.customName).map((s) => s.name));
  const selP = new Set(preview.presets.map((p) => p.id));
  let overwrite = false;
  const list = h('div', { class: 'col', style: { gap: '4px', maxHeight: '46vh', overflow: 'auto' } });
  const status = (s) => !s.hasFile ? h('span', { class: 'badge' }, 'metadata only') : !s.exists ? h('span', { class: 'badge accent' }, 'new') : s.identical ? h('span', { class: 'badge' }, 'already installed') : h('span', { class: 'badge gold' }, 'different version');
  const draw = () => list.replaceChildren(
    ...preview.scenarios.map((s) => h('label', { class: 'row filter-item', style: { padding: '7px 9px' } },
      h('input', { type: 'checkbox', checked: selS.has(s.name), onchange: (e) => { e.target.checked ? selS.add(s.name) : selS.delete(s.name); } }),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis', style: { color: 'var(--text)', fontWeight: 600 } }, s.customName || s.name),
        s.customName ? h('div', { class: 'small muted ellipsis' }, s.name) : null),
      h('div', { class: 'chips' }, s.tags.slice(0, 3).map((t) => h('span', { class: 'chip sm', '--c': '#64748b' }, t))), status(s))),
    ...preview.presets.map((p) => h('label', { class: 'row filter-item', style: { padding: '7px 9px' } },
      h('input', { type: 'checkbox', checked: selP.has(p.id), onchange: (e) => { e.target.checked ? selP.add(p.id) : selP.delete(p.id); } }),
      icon('sliders'), h('div', { class: 'grow', style: { color: 'var(--text)', fontWeight: 600 } }, p.name), h('span', { class: 'badge' }, p.exists ? 'preset · exists' : 'preset'))));
  draw();
  modal({
    title: `Import "${preview.name}"`, wide: true,
    body: h('div', { class: 'col', style: { gap: '14px' } },
      h('div', null, preview.author ? h('span', null, 'by ', h('b', { style: { color: 'var(--text)' } }, preview.author), ' · ') : null, h('span', { class: 'muted' }, `${preview.scenarios.length} scenarios · ${preview.presets.length} presets`)),
      preview.description ? h('div', { class: 'card pad', style: { background: 'var(--bg-2)' } }, preview.description) : null,
      list,
      h('div', { class: 'row' }, toggle(false, (v) => { overwrite = v; }), h('div', null, h('div', { style: { fontWeight: 600, color: 'var(--text)' } }, 'Overwrite existing'), h('div', { class: 'small muted' }, 'Replace scenario files with different versions and use the pack\'s names/notes/thumbnails. Replaced files are backed up first.')))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Import', kind: 'primary', onClick: async () => {
        try {
          const r = await call('packs.import', { path: preview.path, scenarios: [...selS], presets: [...selP], overwrite });
          applyLibrary(await call('library.list'));
          toast(`Imported: ${r.installed} scenario file(s) installed, ${r.skipped} skipped, ${r.metaUpdated} updated with tags/names, ${r.presetsAdded} preset(s)`, 'ok');
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    }],
  });
}

export async function importFromFile(file) {
  try {
    if (!/\.(kpack|zip)$/i.test(file.name)) { toast('Drop a .kpack file to import it'); return; }
    const preview = await call('packs.previewData', { dataUrl: await fileToDataUrl(file), name: file.name });
    importPack(preview);
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ view
export async function render(page) {
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Import / Export'),
    h('div', { class: 'sub' }, 'Share scenarios (with your names, tags and thumbnails) and settings presets as a single .kpack file.'))));

  const importCard = h('div', { class: 'card pad' },
    h('h3', null, icon('upload'), 'Import a pack'),
    h('div', { class: 'muted', style: { marginBottom: '14px' } }, 'Got a .kpack from a friend? Pick it here or just drop it anywhere on this window. You\'ll see exactly what\'s inside before anything is installed.'),
    h('button', { class: 'btn primary lg', onclick: async () => { try { importPack(await call('packs.pickImport')); } catch (e) { toast(e.message, 'error'); } } }, icon('folder'), 'Choose .kpack file…'));

  const quickCard = h('div', { class: 'card pad' },
    h('h3', null, icon('layers'), 'Quick exports'),
    h('div', { class: 'col' },
      quick('Everything I\'ve customized', 'All scenarios with a custom name, tag, note or image, plus every preset. Good for backups or moving to a new PC.', async () => {
        const lib = await loadLibrary();
        const presets = await call('presets.list');
        exportItems({ scenarios: lib.filter((s) => s.customName || s.tags.length || s.hasNotes || s.thumbnail || s.favorite).map((s) => s.name), presets: presets.map((p) => p.id), name: 'My Kovaak\'s Plus setup' });
      }),
      quick('All presets', 'Every settings preset you\'ve saved.', async () => { const p = await call('presets.list'); if (!p.length) return toast('No presets yet'); exportItems({ presets: p.map((x) => x.id), name: 'My presets' }); }),
      quick('Favorites', 'Your starred scenarios.', async () => { const lib = await loadLibrary(); const f = lib.filter((s) => s.favorite); if (!f.length) return toast('No favorites yet'); exportItems({ scenarios: f.map((s) => s.name), name: 'Favorites' }); })));

  page.append(h('div', { class: 'grid c2', style: { marginBottom: '18px' } }, importCard, quickCard));

  // ---- pack builder ----
  const builder = h('div', { class: 'card pad' });
  page.append(builder);
  const lib = await loadLibrary().catch(() => []);
  const presets = await call('presets.list').catch(() => []);
  const chosen = new Set();
  const chosenPresets = new Set();
  const search = h('input', { class: 'input', placeholder: 'Search scenarios to add…' });
  const results = h('div', { class: 'col', style: { gap: '2px', maxHeight: '340px', overflow: 'auto' } });
  const picked = h('div', { class: 'col', style: { gap: '2px', maxHeight: '340px', overflow: 'auto' } });
  const summary = h('div', { class: 'row' });
  search.addEventListener('input', debounce(drawResults, 100));

  function drawResults() {
    const q = search.value.trim().toLowerCase();
    const list = (q ? lib.filter((s) => (s.name + ' ' + (s.customName || '')).toLowerCase().includes(q)) : lib.filter((s) => s.plays).sort((a, b) => b.plays - a.plays)).slice(0, 80);
    results.replaceChildren(...list.map((s) => h('div', { class: 'row filter-item', onclick: () => { chosen.has(s.name) ? chosen.delete(s.name) : chosen.add(s.name); drawAll(); } },
      h('input', { type: 'checkbox', checked: chosen.has(s.name), style: { pointerEvents: 'none' } }),
      h('span', { class: 'grow ellipsis', style: { color: 'var(--text)' } }, displayName(s)), !s.installed ? h('span', { class: 'badge' }, 'not installed') : null)));
  }
  function drawPicked() {
    picked.replaceChildren(...[...chosen].map((n) => h('div', { class: 'row filter-item' },
      h('span', { class: 'grow ellipsis', style: { color: 'var(--text)' } }, displayName(lib.find((s) => s.name === n)) || n),
      h('button', { class: 'btn ghost icon sm', onclick: () => { chosen.delete(n); drawAll(); } }, icon('x')))),
      chosen.size ? null : h('div', { class: 'muted small', style: { padding: '10px' } }, 'Nothing added yet.'));
  }
  function drawAll() {
    drawResults(); drawPicked();
    summary.replaceChildren(h('span', { class: 'muted' }, `${chosen.size} scenarios · ${chosenPresets.size} presets`), h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => { chosen.clear(); chosenPresets.clear(); drawAll(); drawPresetChips(); } }, 'Clear'),
      h('button', { class: 'btn primary', disabled: !chosen.size && !chosenPresets.size, onclick: () => exportItems({ scenarios: [...chosen], presets: [...chosenPresets], name: 'Custom pack' }) }, icon('download'), 'Export pack…'));
  }
  const presetChips = h('div', { class: 'chips' });
  function drawPresetChips() {
    presetChips.replaceChildren(...presets.map((p) => h('span', { class: 'chip btnlike ' + (chosenPresets.has(p.id) ? 'on' : 'off'), '--c': 'var(--accent)', onclick: () => { chosenPresets.has(p.id) ? chosenPresets.delete(p.id) : chosenPresets.add(p.id); drawPresetChips(); drawAll(); } }, p.name)),
      presets.length ? null : h('span', { class: 'muted small' }, 'No presets saved yet.'));
  }

  const usedTags = state.tags.filter((t) => lib.some((s) => s.tags.includes(t.id)));
  builder.append(
    h('h3', null, icon('box'), 'Build a custom pack'),
    h('div', { class: 'small muted', style: { marginBottom: '10px' } }, usedTags.length ? 'Add whole tags at once:' : 'Tip: once you tag scenarios, you can add a whole tag to a pack in one click here.'),
    h('div', { class: 'chips', style: { marginBottom: '16px' } }, usedTags.map((t) =>
      tagChip(t, { cls: 'btnlike', title: 'Add every scenario with this tag', onClick: () => { lib.filter((s) => s.tags.includes(t.id)).forEach((s) => chosen.add(s.name)); drawAll(); } }))),
    h('div', { class: 'grid c2' },
      h('div', { class: 'col' }, h('div', { class: 'search' }, icon('search'), search), results),
      h('div', { class: 'col' }, h('div', { class: 'small muted', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', padding: '9px 0' } }, 'In this pack'), picked)),
    h('div', { style: { marginTop: '16px' } }, h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Presets:'), presetChips),
    h('div', { style: { marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border)' } }, summary));
  drawPresetChips();
  drawAll();
}

function quick(title, text, onClick) {
  return h('div', { class: 'row filter-item', style: { padding: '10px 12px', alignItems: 'flex-start' }, onclick: onClick },
    h('div', { class: 'grow' }, h('div', { style: { color: 'var(--text)', fontWeight: 600 } }, title), h('div', { class: 'small muted' }, text)),
    icon('download'));
}
