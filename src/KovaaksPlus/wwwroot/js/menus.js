// Right-click menus for scenarios (single and bulk).
import { call } from './rpc.js';
import { contextMenu, promptBox, toast } from './ui.js';
import { state, scenario, displayName, patchScenario, applyLibrary } from './state.js';
import { play, pickPreset, presetName, loadPresets } from './play.js';
import { openTagPicker } from './tags.js';
import { openScenario } from './drawer.js';
import { openScenarioLeaderboard } from './lb.js';
import { openScenarioCalculator } from './calc.js';
import { exportItems } from './views/packs.js';

async function setMeta(name, patch) {
  try {
    const res = await call('library.setMeta', { name, ...patch });
    if (scenario(name)) patchScenario(name, res.meta);
    else applyLibrary(await call('library.list'));
    return res;
  } catch (e) { toast(e.message, 'error'); }
}

export async function scenarioMenu(e, name, opts = {}) {
  e.preventDefault();
  const s = scenario(name) || { name, tags: [], favorite: false, hidden: false };
  if (!state.presets) loadPresets();
  const pName = s.preset ? presetName(s.preset) : null;
  contextMenu(e, [
    { header: displayName(s) },
    { label: 'Play challenge', icon: 'play', onClick: () => play(name, 'challenge') },
    { label: 'Play freeplay', icon: 'target', onClick: () => play(name, 'freeplay') },
    { sep: true },
    { label: s.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', iconClass: s.favorite ? 'fav-star' : '', onClick: () => setMeta(name, { favorite: !s.favorite }) },
    { label: s.hidden ? 'Unhide' : 'Hide from library', icon: s.hidden ? 'eye' : 'eyeOff', onClick: () => setMeta(name, { hidden: !s.hidden }) },
    { label: 'Edit tags…', icon: 'tag', onClick: () => openTagPicker('Tags · ' + displayName(s), s.tags || [], (ids) => setMeta(name, { tags: ids })) },
    { label: 'Rename…', icon: 'edit', onClick: async () => {
      const v = await promptBox('Rename scenario', 'Display name (only inside Kovaak\'s Plus; the game file keeps its name)', s.customName || name);
      if (v != null) setMeta(name, { customName: v.trim() && v.trim() !== name ? v.trim() : null });
    } },
    { label: 'Set thumbnail…', icon: 'image', onClick: async () => { const f = await call('media.pick', { kind: 'image', owner: 'scenario:' + name, target: 'thumbnail' }).catch((x) => toast(x.message, 'error')); if (f) setMeta(name, { thumbnail: f }); } },
    s.thumbnail ? { label: 'Remove thumbnail', icon: 'trash', onClick: () => setMeta(name, { thumbnail: null }) } : null,
    { label: 'Default preset…', icon: 'sliders', hint: pName || '', onClick: async () => {
      const id = await pickPreset('Default preset · ' + displayName(s), s.preset, 'Falls back to a tag\'s default preset, if any');
      if (id != null) setMeta(name, { preset: id || null });
    } },
    { sep: true },
    { label: 'Leaderboard', icon: 'chart', onClick: () => openScenarioLeaderboard(name, displayName(s)) },
    { label: 'Calculator…', icon: 'target', onClick: async () => {
      const d = await call('library.detail', { name }).catch(() => null);
      const pb = d && d.runs && d.runs.length ? Math.max(...d.runs.map((r) => r.score)) : (s.pb || 0);
      openScenarioCalculator({ name, display: displayName(s), pb, benchmarks: (d && d.benchmarks) || [] });
    } },
    { label: 'Details', icon: 'library', onClick: () => openScenario(name) },
    { label: 'Export…', icon: 'download', onClick: () => exportItems({ scenarios: [name], name: displayName(s) }) },
    s.installed ? { label: 'Show file in Explorer', icon: 'folder', onClick: () => call('library.revealScenario', { name }) } : null,
    ...(opts.extra || []),
  ]);
}

/** Menu for several selected scenarios. `done` is called after a change so the caller can refresh. */
export function bulkMenu(e, names, done) {
  const n = names.length;
  const run = async (params, msg) => {
    try { await call('library.bulk', { names, ...params }); applyLibrary(await call('library.list')); toast(msg, 'ok'); done && done(); }
    catch (x) { toast(x.message, 'error'); }
  };
  contextMenu(e, [
    { header: `${n} scenarios selected` },
    { label: 'Add tags…', icon: 'tag', onClick: () => openTagPicker(`Add tags to ${n} scenarios`, [], (ids) => run({ addTags: ids }, 'Tags added')) },
    { label: 'Remove tags…', icon: 'tag', onClick: () => openTagPicker(`Remove tags from ${n} scenarios`, [], (ids) => run({ removeTags: ids }, 'Tags removed')) },
    { label: 'Add to favorites', icon: 'star', onClick: () => run({ favorite: true }, 'Added to favorites') },
    { label: 'Remove from favorites', icon: 'star', onClick: () => run({ favorite: false }, 'Removed from favorites') },
    { label: 'Hide', icon: 'eyeOff', onClick: () => run({ hidden: true }, 'Hidden') },
    { label: 'Unhide', icon: 'eye', onClick: () => run({ hidden: false }, 'Unhidden') },
    { label: 'Set default preset…', icon: 'sliders', onClick: async () => {
      const id = await pickPreset(`Default preset for ${n} scenarios`, null);
      if (id != null) run({ preset: id || null }, id ? 'Default preset set' : 'Default preset cleared');
    } },
    { sep: true },
    { label: `Export ${n} as pack…`, icon: 'download', onClick: () => exportItems({ scenarios: names, name: `${n} scenarios` }) },
  ]);
}
