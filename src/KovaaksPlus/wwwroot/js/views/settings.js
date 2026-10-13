import { call } from '../rpc.js';
import { h, icon, toggle, toast, seg, modal, confirmBox } from '../ui.js';
import { state, saveConfig, loadLibrary } from '../state.js';
import { THEMES, FONTS, BASE_KEYS, appearance, effectiveColors, themeById } from '../theme.js';

const ACCENTS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899'];
const KEYS = ['Escape', 'Tab', 'Oemtilde', 'P', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const KEY_LABEL = { Escape: 'Esc', Oemtilde: '` (backtick)', Tab: 'Tab' };

export async function render(page) {
  const c = state.config;
  const set = async (patch, msg) => { try { await saveConfig(patch); if (msg) toast(msg, 'ok'); } catch (e) { toast(e.message, 'error'); } };

  const steam = h('input', { class: 'input', value: c.steamId || '', placeholder: '17-digit SteamID64', style: { width: '220px' } });
  steam.addEventListener('change', () => set({ steamId: steam.value.trim() || null }, 'Steam ID saved'));

  const keySel = h('select', { class: 'input', style: { width: '160px' } }, KEYS.map((k) => h('option', { value: k, selected: k === c.pauseKey }, KEY_LABEL[k] || k)));
  keySel.addEventListener('change', () => set({ pauseKey: keySel.value }, 'Pause key updated'));

  const modeSel = h('select', { class: 'input', style: { width: '160px' } }, [['challenge', 'Challenge'], ['freeplay', 'Freeplay']].map(([v, l]) => h('option', { value: v, selected: v === c.defaultMode }, l)));
  modeSel.addEventListener('change', () => set({ defaultMode: modeSel.value }));

  const presetSel = h('select', { class: 'input', style: { width: '200px' } },
    [['ask', 'Ask each time'], ['auto', 'Apply automatically'], ['off', 'Never apply']].map(([v, l]) => h('option', { value: v, selected: v === (c.presetMode || 'ask') }, l)));
  presetSel.addEventListener('change', () => set({ presetMode: presetSel.value }));

  const custom = h('input', { type: 'color', class: 'color-in', value: c.accent || '#8b5cf6' });
  custom.addEventListener('change', () => set({ accent: custom.value }));

  page.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'App Settings'), h('div', { class: 'sub' }, `Kovaak's Plus v${state.version}`))),
    h('div', { class: 'grid c2', style: { alignItems: 'start' } },
      h('div', { class: 'col', style: { gap: '16px' } },
        section('Game & account', [
          row('KovaaK\'s folder', c.gamePath || 'Not set', h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: async () => {
              const p = await call('app.pickFolder', { title: 'Select the FPSAimTrainer folder' });
              if (!p) return;
              const v = await call('app.validateGamePath', { path: p });
              if (!v.valid) return toast('That doesn\'t look like a KovaaK\'s install (expected an FPSAimTrainer subfolder).', 'error');
              await set({ gamePath: p }, 'Folder updated. Reindexing…');
              loadLibrary(true).catch(() => { });
              page.replaceChildren(); render(page);
            } }, icon('folder'), 'Change'),
            h('button', { class: 'btn ghost sm icon', title: 'Open in Explorer', onclick: () => call('app.reveal', { what: 'game' }) }, icon('external')))),
          row('Workshop folders', `${(c.workshopPaths || []).length} found`, h('button', { class: 'btn sm', onclick: async () => {
            const d = await call('app.detect');
            await set({ workshopPaths: d.workshopPaths, gamePath: c.gamePath || d.gamePath }, `Found ${d.workshopPaths.length} workshop folder(s)`);
            page.replaceChildren(); render(page);
          } }, icon('refresh'), 'Re-detect')),
          row('Steam ID', c.steamName ? `Signed in as ${c.steamName}. Used for evxl.app ranks and leaderboard scores` : 'Used for evxl.app ranks and leaderboard scores', h('div', { class: 'row' }, steam,
            h('button', { class: 'btn ghost sm', title: 'Detect from Steam', onclick: async () => { const d = await call('app.detect'); steam.value = d.steamId || ''; await set({ steamId: d.steamId, steamName: d.steamName }, d.steamId ? 'Detected ' + (d.steamName || d.steamId) : 'No Steam login found'); } }, 'Detect'))),
        ]),
        section('Window switching', [
          row('Pausing brings Kovaak\'s Plus forward', 'When KovaaK\'s is focused and you press the pause key', h('div', { class: 'row' }, keySel, toggle(c.pauseBringsApp, (v) => set({ pauseBringsApp: v })))),
          row('Show results when a run ends', 'Brings this app forward with your stats and PB comparison', toggle(c.runEndBringsApp, (v) => set({ runEndBringsApp: v }))),
          row('Focus KovaaK\'s when launching a scenario', 'Switch straight to the game after picking a scenario', toggle(c.focusGameOnPlay, (v) => set({ focusGameOnPlay: v }))),
          row('Default play mode', 'Used by the Play buttons', modeSel),
          row('Default presets', 'When a scenario (or its tag) has a preset that differs from your current settings', presetSel),
        ]),
        section('Returning to KovaaK\'s', [
          row('Resuming from the pause bar', 'Space / Resume / Back to game while paused', select([['restart', 'Restart the scenario'], ['continue', 'Continue where I paused']], c.pauseResume || 'restart', (v) => set({ pauseResume: v }))),
          row('After a run ends', 'Space on the results screen', select([['restart', 'Restart the same scenario'], ['next', 'Play the next scenario in the queue'], ['focus', 'Just switch to KovaaK\'s']], c.afterRun || 'restart', (v) => set({ afterRun: v }))),
          row('KovaaK\'s restart key', 'Pressed for you after switching back', restartKeyControl(c, set)),
          h('div', { class: 'small muted', style: { paddingTop: '8px' } }, 'The queue is the list you launched from: a benchmark difficulty, or the scenarios currently shown in the library. The key is only sent once KovaaK\'s is confirmed to be in front.'),
        ]),
      ),
      h('div', { class: 'col', style: { gap: '16px' } },
        section('Rewards & library', [
          row('Celebrate new personal bests', 'Confetti and a gold results screen', toggle(c.celebratePB, (v) => set({ celebratePB: v }))),
          row('Sounds', 'Short chime on a new PB', toggle(c.sounds, (v) => set({ sounds: v }))),
          row('Show scenarios that aren\'t installed', 'Scenarios you have stats for but no local file', toggle(c.showUninstalled, (v) => set({ showUninstalled: v }))),
          row('Name on tag thumbnails', 'Overlay the scenario name when a card uses its tag\'s thumbnail', toggle(c.tagThumbNames !== false, (v) => set({ tagThumbNames: v }))),
        ]),
        appearanceSection(c, set),
        section('Data', [
          row('Kovaak\'s Plus data', 'Tags, names, presets, thumbnails, backups', h('button', { class: 'btn sm', onclick: () => call('app.openDataFolder') }, icon('folder'), 'Open')),
          row('Thumbnails & icons', 'media\\scenarios, media\\tags and media\\presets, one folder per item', h('button', { class: 'btn sm', onclick: () => call('media.openFolder') }, icon('folder'), 'Open')),
          row('Clean up unused files', 'Find thumbnails, previews and icons nothing uses any more, and links to files that are gone', h('button', { class: 'btn sm', onclick: (e) => cleanUpMedia(e.currentTarget) }, icon('trash'), h('span', null, 'Scan'))),
          row('Clean up automatically on launch', 'Each time the app starts, unused files go to the Recycle Bin and broken links are cleared', toggle(c.autoCleanMedia, (v) => set({ autoCleanMedia: v }))),
          row('KovaaK\'s stats folder', 'Where run CSVs are saved', h('button', { class: 'btn sm', onclick: () => call('app.reveal', { what: 'stats' }) }, icon('folder'), 'Open')),
          row('Re-run setup', 'Walk through first-time setup again', h('button', { class: 'btn sm', onclick: async () => { await saveConfig({ setupComplete: false }); location.reload(); } }, 'Run setup')),
        ]),
        h('div', { class: 'card pad small muted' },
          h('b', { style: { color: 'var(--text-2)' } }, 'Sharing with friends: '), 'send them ', h('b', null, 'KovaaksPlus.exe'), '. It finds KovaaK\'s, their workshop scenarios and their Steam account by itself. Your tags and presets travel separately as .kpack files.',
          h('div', { style: { marginTop: '10px' } }, 'Benchmark data from ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); call('app.openUrl', { url: 'https://evxl.app' }); } }, 'evxl.app'), ' and KovaaK\'s. Kovaak\'s Plus never modifies the game, reads its memory, or touches your scenario files (except when you import a pack).')))));
}

const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

/** Scans the media folder for files nothing uses any more (replaced/removed thumbnails, previews, icons) and offers to recycle them. */
async function cleanUpMedia(btn) {
  btn.disabled = true;
  const label = btn.lastChild.textContent;
  btn.lastChild.textContent = 'Scanning…';
  let scan;
  try { scan = await call('media.scanUnused'); }
  catch (e) { toast(e.message, 'error'); return; }
  finally { btn.disabled = false; btn.lastChild.textContent = label; }

  const files = scan.files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length && !scan.missing.length && !scan.emptyFolders) { toast(`Nothing to clean up: all ${scan.referenced} media files are in use.`, 'ok'); return; }

  const chosen = new Set(files.map((f) => f.path));
  let clearMissing = scan.missing.length > 0;
  const summary = h('div', { class: 'small muted' });
  const drawSummary = () => {
    const bytes = files.filter((f) => chosen.has(f.path)).reduce((a, f) => a + f.size, 0);
    summary.textContent = `${chosen.size} of ${files.length} file${files.length === 1 ? '' : 's'} selected · ${fmtBytes(bytes)}`;
  };
  const list = h('div', { class: 'clean-list' }, files.map((f) => {
    const cb = h('input', { type: 'checkbox', checked: true });
    cb.addEventListener('change', () => { cb.checked ? chosen.add(f.path) : chosen.delete(f.path); drawSummary(); });
    const folder = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
    return h('label', { class: 'clean-row' }, cb,
      h('span', { class: 'ellipsis grow', title: f.path }, h('span', { class: 'muted' }, folder), f.path.slice(folder.length)),
      h('span', { class: 'muted small num' }, fmtBytes(f.size)));
  }));
  drawSummary();
  const missingBox = scan.missing.length ? h('label', { class: 'row', style: { alignItems: 'flex-start', gap: '10px' } },
    (() => { const cb = h('input', { type: 'checkbox', checked: true, style: { marginTop: '3px' } }); cb.addEventListener('change', () => { clearMissing = cb.checked; }); return cb; })(),
    h('div', null, h('b', null, `Also clear ${scan.missing.length} link${scan.missing.length === 1 ? '' : 's'} to files that no longer exist`),
      h('div', { class: 'small muted' }, scan.missing.slice(0, 4).join(' · ') + (scan.missing.length > 4 ? ` · +${scan.missing.length - 4} more` : '')))) : null;

  modal({
    title: 'Clean up unused files', wide: true,
    body: h('div', { class: 'col', style: { gap: '12px' } },
      h('div', null, files.length
        ? 'These media files aren\'t used by any scenario, tag or preset (usually thumbnails and previews you replaced or removed). They go to the Recycle Bin, so you can still restore them.'
        : 'No unused media files.', scan.emptyFolders ? ` Empty folders (${scan.emptyFolders}) are removed too.` : ''),
      files.length ? h('div', { class: 'row' }, summary, h('div', { class: 'grow' }),
        h('button', { class: 'btn ghost sm', onclick: () => { const all = chosen.size !== files.length; list.querySelectorAll('input').forEach((cb, i) => { cb.checked = all; all ? chosen.add(files[i].path) : chosen.delete(files[i].path); }); drawSummary(); } }, 'Select all / none')) : null,
      files.length ? list : null,
      missingBox),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Clean up', kind: 'danger', onClick: async () => {
        try {
          const r = await call('media.cleanUnused', { files: [...chosen], clearMissing });
          const parts = [];
          if (r.deleted) parts.push(`${r.deleted} file${r.deleted === 1 ? '' : 's'} (${fmtBytes(r.bytes)}) moved to the Recycle Bin`);
          if (r.folders) parts.push(`${r.folders} empty folder${r.folders === 1 ? '' : 's'} removed`);
          if (r.cleared) parts.push(`${r.cleared} broken link${r.cleared === 1 ? '' : 's'} cleared`);
          if (r.skipped) parts.push(`${r.skipped} skipped (now in use or already gone)`);
          toast(parts.join(' · ') || 'Nothing changed', 'ok');
          if (r.cleared) await loadLibrary(true);
        } catch (e) { toast(e.message, 'error'); return false; }
      } },
    ],
  });
}

/**
 * Launch-time version of the cleanup (App Settings → Data → Clean up automatically on launch): recycles every unused
 * media file and clears links to missing files without asking, and only says something when it did anything.
 */
export async function autoCleanMedia() {
  try {
    const scan = await call('media.scanUnused');
    if (!scan.files.length && !scan.missing.length && !scan.emptyFolders) return;
    const r = await call('media.cleanUnused', { files: scan.files.map((f) => f.path), clearMissing: true });
    const parts = [];
    if (r.deleted) parts.push(`${r.deleted} unused file${r.deleted === 1 ? '' : 's'} (${fmtBytes(r.bytes)}) moved to the Recycle Bin`);
    if (r.cleared) parts.push(`${r.cleared} broken link${r.cleared === 1 ? '' : 's'} cleared`);
    if (parts.length) toast('Cleanup: ' + parts.join(' · '), 'ok');
    if (r.cleared) await loadLibrary(true);
  } catch { /* best effort; the manual Scan button reports errors */ }
}

const RESTART_KEYS = ['R', 'T', 'F', 'E', 'Q', 'G', 'X', 'Z', 'Space', 'Return', 'Back', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const RESTART_LABEL = { Return: 'Enter', Back: 'Backspace' };

/** "Auto" reads KovaaK's own ResetSession bind from its Input.ini; otherwise a fixed key. */
function restartKeyControl(c, set) {
  const s = select([['auto', 'Auto (from KovaaK\'s binds)'], ...RESTART_KEYS.map((k) => [k, RESTART_LABEL[k] || k])], (c.restartKey || 'auto'), (v) => set({ restartKey: v }, 'Restart key updated').then(refresh));
  const note = h('span', { class: 'small muted' });
  const refresh = () => call('game.restartKey').then((r) => { note.textContent = r.detected ? `KovaaK's bind: ${RESTART_LABEL[r.detected] || r.detected}` : 'No bind found'; }).catch(() => { });
  refresh();
  return h('div', { class: 'col', style: { alignItems: 'flex-end', gap: '4px' } }, s, note);
}

function select(options, value, onChange) {
  const s = h('select', { class: 'input', style: { width: '230px' } }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/** Appearance card. Re-renders itself after every change so selections always reflect what's applied. */
function appearanceSection(c, set) {
  const host = h('div', { class: 'card pad' });
  const saveA = async (patch, extra = {}) => {
    const ui = JSON.parse(JSON.stringify(state.config.ui || {}));
    ui.appearance = { ...appearance(), ...patch };
    await set({ ui, ...extra });
    draw();
  };

  const draw = () => {
    const a = appearance();
    const colors = effectiveColors(a);
    const accent = state.config.accent || '#8b5cf6';
    const colorIn = (value, onPick) => {
      const i = h('input', { type: 'color', class: 'color-in', value });
      i.addEventListener('change', () => onPick(i.value));
      return i;
    };
    const swatch = (color, current, onPick) => h('button', {
      title: color, onclick: onPick, class: 'swatch' + (color.toLowerCase() === (current || '').toLowerCase() ? ' on' : ''), style: { background: color },
    });

    const tile = (id, t) => h('div', {
      class: 'theme-tile' + (a.theme === id ? ' on' : ''), style: { background: t.colors.bg, borderColor: t.colors.border },
      onclick: () => saveA({ theme: id, custom: {}, ...(t.accent2 ? { accent2: t.accent2 } : {}) }, t.accent ? { accent: t.accent } : {}),
    },
      h('span', { style: { background: t.colors.surface, borderColor: t.colors.border } }, h('i', { style: { background: t.accent || accent } }), h('i', { style: { background: t.colors.muted, width: '60%' } })),
      h('b', { style: { color: t.colors.text } }, t.label),
      t.user ? h('div', { class: 'theme-tools' },
        h('button', { title: 'Edit theme', onclick: (e) => { e.stopPropagation(); editTheme(id); } }, icon('edit')),
        h('button', { title: 'Delete theme', onclick: async (e) => {
          e.stopPropagation();
          if (!await confirmBox('Delete theme?', `"${t.label}" will be removed.`, 'Delete', 'danger')) return;
          saveA({ userThemes: a.userThemes.filter((x) => x.id !== id), theme: a.theme === id ? 'midnight' : a.theme });
        } }, icon('trash'))) : null);

    const overridden = Object.keys(a.custom || {}).length > 0;
    const scaleLabel = h('span', { class: 'small muted num', style: { width: '40px', textAlign: 'right' } }, a.scale + '%');
    const scale = h('input', { type: 'range', min: 80, max: 130, step: 5, value: a.scale, style: { width: '160px', accentColor: 'var(--accent)' } });
    scale.addEventListener('input', () => { scaleLabel.textContent = scale.value + '%'; });
    scale.addEventListener('change', () => saveA({ scale: +scale.value }));
    const radLabel = h('span', { class: 'small muted num', style: { width: '40px', textAlign: 'right' } }, a.radiusPx + 'px');
    const rad = h('input', { type: 'range', min: 2, max: 24, step: 1, value: a.radiusPx, style: { width: '130px', accentColor: 'var(--accent)' } });
    rad.addEventListener('input', () => { radLabel.textContent = rad.value + 'px'; document.documentElement.style.setProperty('--radius', rad.value + 'px'); });
    rad.addEventListener('change', () => saveA({ radiusPx: +rad.value }));

    host.replaceChildren(
      h('h3', null, 'Appearance', h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', onclick: () => { const ui = JSON.parse(JSON.stringify(state.config.ui || {})); const keep = (ui.appearance || {}).userThemes; ui.appearance = keep ? { userThemes: keep } : undefined; set({ ui, accent: '#8b5cf6' }, 'Appearance reset').then(draw); } }, 'Reset')),
      h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Theme'),
      h('div', { class: 'theme-grid' },
        ...Object.entries(THEMES).map(([id, t]) => tile(id, t)),
        ...a.userThemes.map((u) => tile(u.id, themeById(u.id, a))),
        h('button', { class: 'theme-tile theme-new', title: 'Save the current colours as a theme', onclick: () => editTheme(null) }, icon('plus'), h('b', null, 'Save as theme'))),
      row('Accent color', 'Buttons, highlights, charts', h('div', { class: 'row', style: { gap: '6px' } }, ...ACCENTS.map((x) => swatch(x, accent, () => set({ accent: x }).then(draw))), colorIn(accent, (v) => set({ accent: v }).then(draw)))),
      row('Secondary color', 'Links, gradients, secondary charts', h('div', { class: 'row', style: { gap: '6px' } }, ...['#22d3ee', '#38bdf8', '#34d399', '#facc15', '#f472b6', '#a78bfa'].map((x) => swatch(x, a.accent2, () => saveA({ accent2: x }))), colorIn(a.accent2, (v) => saveA({ accent2: v })))),
      ...BASE_KEYS.map(([k, label]) => row(label, a.custom[k] ? 'Custom (differs from the theme)' : null, h('div', { class: 'row' },
        a.custom[k] ? h('button', { class: 'btn ghost sm', title: 'Back to the theme colour', onclick: () => { const cu = { ...a.custom }; delete cu[k]; saveA({ custom: cu }); } }, 'Reset') : null,
        colorIn(colors[k], (v) => saveA({ custom: { ...a.custom, [k]: v } }))))),
      overridden ? h('div', { class: 'row', style: { padding: '6px 0' } }, h('span', { class: 'small muted grow' }, 'You\'ve customised some colours.'),
        h('button', { class: 'btn sm', onclick: () => editTheme(null) }, icon('plus'), 'Save as theme'),
        h('button', { class: 'btn ghost sm', onclick: () => saveA({ custom: {} }) }, 'Reset colours')) : null,
      row('Font', null, select(Object.entries(FONTS).map(([k, f]) => [k, f.label]), a.font, (v) => saveA({ font: v }))),
      row('Interface scale', 'Zoom the whole app', h('div', { class: 'row' }, scale, scaleLabel)),
      row('Corners', a.radius === 'rounded' ? 'Corner radius' : null, h('div', { class: 'row' },
        seg([{ value: 'sharp', label: 'Sharp' }, { value: 'rounded', label: 'Rounded' }], a.radius, (v) => saveA({ radius: v })),
        a.radius === 'rounded' ? rad : null, a.radius === 'rounded' ? radLabel : null)),
      row('Density', 'Spacing of cards, tables and pages', select([['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']], a.density, (v) => saveA({ density: v }))),
      row('Scenario card size', null, select([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], a.cardSize, (v) => saveA({ cardSize: v }))),
      row('Glow effects', 'Background glows and coloured shadows', toggle(a.glow, (v) => saveA({ glow: v }))),
      row('Animations', 'Turn off for a calmer, snappier interface', toggle(a.motion, (v) => saveA({ motion: v }))),
      row('Highlight PB runs', 'Gold gradient on personal-best runs in run lists', toggle(a.pbGradient, (v) => saveA({ pbGradient: v }))),
      row('Dim runs from earlier days', 'Keep today\'s runs bright in run lists', toggle(a.dimOld, (v) => saveA({ dimOld: v }))),
      row('Preview on hover', 'Hovering a scenario plays its preview: over the card in grid view, in a pop-up in lists and tables', toggle(a.hoverPreview, (v) => saveA({ hoverPreview: v }))));
  };

  /** Create (id = null, from the current colours) or edit a user theme. */
  function editTheme(id) {
    const a = appearance();
    const existing = id ? a.userThemes.find((t) => t.id === id) : null;
    const work = existing ? { ...existing, colors: { ...existing.colors } }
      : { id: 'u' + Math.random().toString(36).slice(2, 9), name: 'My theme', colors: effectiveColors(a), accent: state.config.accent, accent2: a.accent2 };
    const name = h('input', { class: 'input', value: work.name });
    const preview = h('div', { class: 'theme-preview' });
    const drawPreview = () => {
      preview.style.background = work.colors.bg;
      preview.replaceChildren(
        h('div', { style: { background: work.colors.sidebar, borderRight: `1px solid ${work.colors.border}` } }),
        h('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: { background: work.colors.surface, border: `1px solid ${work.colors.border}`, borderRadius: '8px', padding: '10px', color: work.colors.text, fontWeight: 600 } }, 'Panel title',
            h('div', { style: { color: work.colors.muted, fontSize: '12px', fontWeight: 400 } }, 'Muted secondary text')),
          h('div', { class: 'row' }, h('span', { style: { background: work.accent, color: '#fff', borderRadius: '7px', padding: '4px 10px', fontSize: '12px' } }, 'Accent'),
            h('span', { style: { color: work.accent2, fontSize: '12px' } }, 'Secondary'))));
    };
    const field = (label, get, setV) => {
      const i = h('input', { type: 'color', class: 'color-in', value: get() });
      i.addEventListener('input', () => { setV(i.value); drawPreview(); });
      return h('label', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'small' }, label), i);
    };
    drawPreview();
    modal({
      title: existing ? 'Edit theme' : 'Save as theme',
      body: h('div', { class: 'col', style: { gap: '12px' } },
        h('label', { class: 'field' }, 'Name', name), preview,
        h('div', { class: 'grid c2', style: { gap: '8px 18px' } },
          field('Accent', () => work.accent, (v) => { work.accent = v; }), field('Secondary', () => work.accent2, (v) => { work.accent2 = v; }),
          ...BASE_KEYS.map(([k, label]) => field(label, () => work.colors[k], (v) => { work.colors[k] = v; })))),
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: existing ? 'Save theme' : 'Create theme', kind: 'primary', onClick: async () => {
          work.name = name.value.trim() || 'My theme';
          const list = existing ? a.userThemes.map((t) => (t.id === id ? work : t)) : [...a.userThemes, work];
          await saveA({ userThemes: list, theme: work.id, custom: {}, accent2: work.accent2 }, { accent: work.accent });
          toast('Theme saved', 'ok');
        },
      }],
    });
  }

  draw();
  return host;
}

function section(title, rows) {
  return h('div', { class: 'card pad' }, h('h3', null, title), ...rows);
}

function row(label, hint, control) {
  return h('div', { class: 'set-row', style: { gridTemplateColumns: 'minmax(0, 1fr) auto' } },
    h('div', { class: 'k' }, label, hint ? h('small', { class: 'ellipsis', title: hint }, hint) : null),
    h('div', { class: 'ctl' }, control));
}
