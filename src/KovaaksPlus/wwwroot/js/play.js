// Launching scenarios (with default-preset handling) and the preset picker.
import { call } from './rpc.js';
import { h, modal, toast, toggle } from './ui.js';
import { state, saveConfig } from './state.js';

// The play queue is the list a scenario was launched from (a benchmark difficulty, the visible library list…).
// "Play next" after a run walks through it.
export function setQueue(names, current) {
  state.queue = names && names.length ? { names: [...names], index: Math.max(0, names.indexOf(current)) } : null;
}
export function nextInQueue(current) {
  const q = state.queue;
  if (!q) return null;
  const i = current ? q.names.findIndex((n) => n.toLowerCase() === current.toLowerCase()) : q.index;
  return i >= 0 && i + 1 < q.names.length ? q.names[i + 1] : null;
}

/** opts: { queue: [names] } sets the queue; otherwise the queue is kept only if it contains this scenario. */
export async function play(name, mode, opts = {}) {
  if (opts.queue) setQueue(opts.queue, name);
  else if (state.queue && state.queue.names.some((n) => n.toLowerCase() === name.toLowerCase())) state.queue.index = state.queue.names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  else state.queue = null;
  try {
    mode = mode || state.config.defaultMode || 'challenge';
    let res = await call('game.play', { name, mode });
    if (res && res.needsPreset) {
      const choice = await presetPrompt(name, res);
      if (!choice) return;
      res = await call('game.play', { name, mode, preset: choice });
    }
    if (res && res.presetApplied) toast(`Applied preset "${res.presetApplied}"`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

function presetPrompt(name, res) {
  return new Promise((resolve) => {
    let remember = false;
    let result = null;
    modal({
      title: 'Apply default preset?',
      body: h('div', { class: 'col', style: { gap: '12px' } },
        h('div', null, h('b', { style: { color: 'var(--text)' } }, name), ' uses the preset ', h('b', { style: { color: 'var(--accent-2)' } }, res.preset.name),
          ', and your current KovaaK\'s settings are different.'),
        res.running ? h('div', { class: 'small muted' }, 'KovaaK\'s reads settings at startup, so applying will close it, write the preset, and relaunch straight into the scenario.') : null,
        h('label', { class: 'row', style: { cursor: 'pointer' } }, toggle(false, (v) => { remember = v; }), h('span', null, 'Don\'t ask again. Always apply default presets automatically'))),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Play without', onClick: () => { result = 'skip'; } },
        { label: res.running ? 'Apply & restart' : 'Apply preset', kind: 'primary', onClick: async () => { result = 'apply'; if (remember) await saveConfig({ presetMode: 'auto' }); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/**
 * Pick a settings preset. Resolves to a preset id, '' for "none", or null when cancelled.
 * `inheritHint` explains what happens with "none" (e.g. falls back to the tag default).
 */
export async function pickPreset(title, current, inheritHint) {
  let presets = [];
  try { presets = await call('presets.list'); } catch { }
  return new Promise((resolve) => {
    let chosen = current || '';
    let result = null;
    const list = h('div', { class: 'col', style: { gap: '4px', maxHeight: '50vh', overflow: 'auto' } });
    const draw = () => list.replaceChildren(
      option('', 'No default preset', inheritHint || 'Play with whatever settings are active'),
      ...presets.map((p) => option(p.id, p.name, p.description || (p.categories || []).join(', '))));
    const option = (id, label, sub) => h('label', { class: 'row filter-item' + (chosen === id ? ' on' : ''), style: { padding: '9px 10px' }, onclick: () => { chosen = id; draw(); } },
      h('input', { type: 'radio', checked: chosen === id, style: { pointerEvents: 'none' } }),
      h('div', { class: 'grow' }, h('div', { style: { color: 'var(--text)', fontWeight: 600 } }, label), sub ? h('div', { class: 'small muted' }, sub) : null));
    draw();
    modal({
      title,
      body: h('div', { class: 'col', style: { gap: '10px' } },
        presets.length ? null : h('div', { class: 'muted small' }, 'You have no presets yet. Create one under Settings & Presets.'),
        list,
        h('div', { class: 'small muted' }, 'When you press Play, the preset is applied first if your current settings differ.')),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: () => { result = chosen; } }],
      onClose: () => resolve(result),
    });
  });
}

export function presetName(id, presets) {
  const p = (presets || state.presets || []).find((x) => x.id === id);
  return p ? p.name : null;
}

export async function loadPresets() {
  try { state.presets = await call('presets.list'); } catch { state.presets = state.presets || []; }
  return state.presets;
}
