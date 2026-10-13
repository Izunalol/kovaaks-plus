// Scenario detail drawer: rename, tag, thumbnail/preview, notes, history, play.
import { call } from './rpc.js';
import { h, icon, thumb, mediaUrl, isVideo, fmtScore, fmtPct, fmtDate, fmtDateTime, timeAgo, toast, tagChip, fileToDataUrl, runRowClass, dropZone } from './ui.js';
import { state, scenario, tagById, patchScenario, primaryTagColor } from './state.js';
import { lineChart, movingAverage } from './charts.js';
import { loadThresholds, pickBenchmark, thresholdOverlay, thresholdPicker } from './thresholds.js';
import { openTagPicker, tagMenu } from './tags.js';
import { showRunDetail } from './runs.js';
import { exportItems } from './views/packs.js';
import { play, pickPreset, presetName, loadPresets } from './play.js';
import { tagThumbs, splitThumb } from './thumbs.js';
import { scenarioLeaderboard, openScenarioLeaderboard } from './lb.js';
import { scenarioCalculator } from './calc.js';

export { play };

let current = null;

export function closeDrawer() {
  if (!current) return;
  current.remove();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('paste', onPaste);
  current = null;
}

function onKey(e) {
  if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) closeDrawer();
}

let pasteTarget = null;
async function onPaste(e) {
  if (!pasteTarget || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  await pasteTarget(item.getAsFile());
}

export async function openScenario(name) {
  closeDrawer();
  const root = document.getElementById('drawer-root');
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: closeDrawer });
  const panel = h('div', { class: 'drawer' }, h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto' } })));
  current = h('div', null, backdrop, panel);
  root.append(current);
  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);

  let detail;
  try { [detail] = await Promise.all([call('library.detail', { name }), loadPresets()]); } catch (e) { toast(e.message, 'error'); closeDrawer(); return; }
  render(panel, detail);
}

function render(panel, d) {
  const s = scenario(d.name) || { name: d.name, tags: [] };
  const meta = d.meta;
  const runs = d.runs || [];
  const pb = runs.length ? Math.max(...runs.map((r) => r.score)) : null;
  const last5 = runs.slice(-5);
  const avg5 = last5.length ? last5.reduce((a, r) => a + r.score, 0) / last5.length : null;

  const save = async (patch) => {
    try {
      const res = await call('library.setMeta', { name: d.name, ...patch });
      patchScenario(d.name, res.meta);
      render(panel, res);
    } catch (e) { toast(e.message, 'error'); }
  };

  const setMedia = async (kind) => {
    const file = await call('media.pick', { kind: kind === 'preview' ? 'video' : 'image', owner: 'scenario:' + d.name, target: kind }).catch((e) => toast(e.message, 'error'));
    if (file) save({ [kind]: file });
  };
  const saveFile = async (file, kind) => {
    if (file.size > 60 * 1024 * 1024) { toast('That file is too large (60 MB max)', 'error'); return; }
    const name = await call('media.saveDataUrl', { dataUrl: await fileToDataUrl(file), owner: 'scenario:' + d.name, target: kind });
    await save({ [kind]: name });
    toast(kind === 'thumbnail' ? 'Thumbnail updated' : 'Preview updated', 'ok');
  };
  pasteTarget = (file) => saveFile(file, 'thumbnail');

  // ---- hero ----
  const heroMedia = meta.preview || meta.thumbnail;
  const inherited = tagThumbs({ tags: meta.tags || [] });
  const hero = h('div', { class: 'drawer-hero' },
    heroMedia
      ? (isVideo(heroMedia) ? h('video', { src: mediaUrl(heroMedia), autoplay: true, muted: true, loop: true, playsinline: true }) : h('img', { src: mediaUrl(heroMedia) }))
      : inherited.length ? (() => { const t = splitThumb(inherited.slice(0, 4), null); t.style.position = 'absolute'; t.style.inset = '0'; t.style.aspectRatio = 'auto'; return t; })()
        : thumb(d.name, null, primaryTagColor(s)),
    h('div', { class: 'hero-actions' },
      dropZone(h('button', { class: 'btn sm', onclick: () => setMedia('thumbnail'), title: 'Card thumbnail: click, drop a file here, or paste with Ctrl+V' }, icon('image'), 'Thumbnail'), (f) => saveFile(f, 'thumbnail'), 'media'),
      dropZone(h('button', { class: 'btn sm', onclick: () => setMedia('preview'), title: 'Large preview: image, GIF or MP4/WebM clip (click or drop a file here)' }, icon('film'), 'Preview'), (f) => saveFile(f, 'preview'), 'media'),
      (meta.thumbnail || meta.preview) ? h('button', { class: 'btn sm icon', title: 'Remove thumbnail & preview', onclick: () => save({ thumbnail: null, preview: null }) }, icon('trash')) : null,
      h('button', { class: 'btn sm icon', title: 'Close', onclick: closeDrawer }, icon('x'))));
  hero.addEventListener('dragover', (e) => { e.preventDefault(); hero.classList.add('drop-hint'); });
  hero.addEventListener('dragleave', () => hero.classList.remove('drop-hint'));
  hero.addEventListener('drop', async (e) => {
    e.preventDefault(); hero.classList.remove('drop-hint');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (/^video\//.test(f.type) || /gif/.test(f.type)) saveFile(f, 'preview');
    else if (/^image\//.test(f.type)) saveFile(f, 'thumbnail');
  });

  // ---- title (custom name) ----
  const title = h('h2', { class: 'drawer-title', contenteditable: 'true', spellcheck: 'false', title: 'Click to rename (only inside Kovaak\'s Plus — the game file is untouched)' }, meta.customName || d.name);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.textContent = meta.customName || d.name; title.blur(); } });
  title.addEventListener('blur', () => {
    const v = title.textContent.trim();
    const next = !v || v === d.name ? null : v;
    if (next !== (meta.customName || null)) save({ customName: next });
  });

  const tagEls = (meta.tags || []).map((id) => tagById(id)).filter(Boolean)
    .map((t) => { const c = tagChip(t, { onRemove: () => save({ tags: meta.tags.filter((x) => x !== t.id) }) }); c.addEventListener('contextmenu', (e) => tagMenu(e, t)); return c; });

  // Default preset: own, else inherited from a tag.
  const tagPreset = state.tags.find((t) => t.preset && (meta.tags || []).includes(t.id));
  const presetRow = h('div', { class: 'row small', style: { marginTop: '10px', gap: '8px' } },
    icon('sliders'), h('span', { class: 'muted' }, 'Default preset:'),
    h('button', { class: 'btn sm', onclick: async () => {
      const id = await pickPreset('Default preset · ' + (meta.customName || d.name), meta.preset, tagPreset ? `Uses the "${tagPreset.name}" tag's preset (${presetName(tagPreset.preset) || '?'})` : null);
      if (id != null) save({ preset: id || null });
    } }, meta.preset ? (presetName(meta.preset) || 'Missing preset') : tagPreset ? `${presetName(tagPreset.preset) || '?'} (from ${tagPreset.name})` : 'None'),
    meta.preset ? h('button', { class: 'btn ghost sm', onclick: () => save({ preset: null }) }, 'Clear') : null);

  const head = h('div', { class: 'drawer-head' },
    title,
    meta.customName ? h('div', { class: 'row small muted', style: { marginTop: '4px' } }, 'In KovaaK\'s: ', h('b', { style: { color: 'var(--text-2)' } }, d.name),
      h('button', { class: 'btn ghost sm', onclick: () => save({ customName: null }) }, 'Reset name')) : null,
    h('div', { class: 'row wrap', style: { marginTop: '12px' } },
      ...tagEls,
      h('button', { class: 'btn sm', onclick: () => openTagPicker('Tags · ' + (meta.customName || d.name), meta.tags || [], (ids) => save({ tags: ids })) }, icon('tag'), 'Edit tags'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', title: meta.favorite ? 'Unfavorite' : 'Favorite', onclick: () => save({ favorite: !meta.favorite }) }, icon('star', meta.favorite ? 'fav-star' : ''), meta.favorite ? 'Favorited' : 'Favorite'),
      h('button', { class: 'btn ghost sm', title: 'Hide from the library', onclick: () => save({ hidden: !meta.hidden }) }, icon(meta.hidden ? 'eye' : 'eyeOff'), meta.hidden ? 'Unhide' : 'Hide')),
    presetRow);

  // ---- stats ----
  const f = d.file;
  const statsSec = h('div', { class: 'drawer-section' },
    h('div', { class: 'kv' },
      kv('Personal best', fmtScore(pb)), kv('Plays', runs.length), kv('Avg (last 5)', fmtScore(avg5)), kv('Last played', runs.length ? timeAgo(runs[runs.length - 1].date) : 'never')),
    h('div', { class: 'row wrap small muted', style: { marginTop: '14px', gap: '16px' } },
      f ? h('span', null, f.source === 'workshop' ? 'Steam Workshop' : 'Local scenario') : h('span', { class: 'down' }, 'Not installed locally — KovaaK\'s will download it when played'),
      f && f.author ? h('span', null, 'by ', h('b', { style: { color: 'var(--text-2)' } }, f.author)) : null,
      f && f.timeLimit ? h('span', null, f.timeLimit + 's') : null,
      f && f.gameTag ? h('span', null, 'Category: ' + f.gameTag) : null,
      f && f.difficulty ? h('span', null, 'Difficulty: ' + f.difficulty) : null));

  const historySec = h('div', { class: 'drawer-section' }, h('h4', null, 'Score history', h('span', { class: 'spacer' }), runs.length > 1 ? h('span', { style: { textTransform: 'none', letterSpacing: 0 } }, `${runs.length} runs since ${fmtDate(runs[0].date)}`) : null));
  if (runs.length > 1) {
    const shown = runs.slice(-150);
    const ma = movingAverage(shown.map((r) => r.score), Math.min(10, Math.max(3, Math.floor(shown.length / 8))));
    const chartHost = h('div');
    historySec.append(chartHost);
    const series = [
      { points: shown.map((r, i) => ({ x: i, y: r.score, pb: r.pb && i > 0, tip: `<b>${fmtScore(r.score)}</b> · ${fmtPct(r.accuracy)}<br><span class="muted">${fmtDateTime(r.date)}${r.pb ? ' · PB' : ''}</span>`, onClick: () => showRunDetail(r.file, meta.customName || d.name) })), color: '#5b6478', width: 1.4, dots: true },
      { points: shown.map((r, i) => ({ x: i, y: ma[i] })), color: 'var(--accent)', width: 2.6, dots: false },
    ];
    // Benchmark rank lines (picker in the section header when the scenario is in a benchmark).
    const drawChart = (bench) => {
      const ov = thresholdOverlay(bench, shown.map((r) => r.score));
      chartHost.replaceChildren();
      lineChart(chartHost, series, { height: 210, hLines: [...ov.hLines, { y: pb, label: 'PB ' + fmtScore(pb) }], bands: ov.bands });
    };
    requestAnimationFrame(() => drawChart(null));
    if ((d.benchmarks || []).length) loadThresholds(d.name).then((list) => {
      const bench = pickBenchmark(list);
      const picker = thresholdPicker(list, bench, drawChart);
      if (picker) historySec.querySelector('h4 .spacer').after(picker);
      if (bench) drawChart(bench);
    });
  } else historySec.append(h('div', { class: 'muted small' }, runs.length ? 'Play a few more runs to see a trend.' : 'No runs recorded yet.'));

  const benchSec = d.benchmarks && d.benchmarks.length ? h('div', { class: 'drawer-section' }, h('h4', null, 'Part of benchmarks'),
    h('div', { class: 'chips' }, d.benchmarks.map((b) => h('span', { class: 'chip btnlike', '--c': '#eab308', onclick: () => { closeDrawer(); location.hash = '#/benchmarks/' + b.id; } }, icon('trophy'), `${b.name || 'Benchmark ' + b.id}${b.difficulty ? ' · ' + b.difficulty : ''}`)))) : null;

  const notes = h('textarea', { class: 'input', placeholder: 'Personal notes: focus points, sens tips, routine reminders…', style: { width: '100%' } }, meta.notes || '');
  notes.addEventListener('blur', () => { if ((notes.value.trim() || null) !== (meta.notes || null)) save({ notes: notes.value }); });
  const notesSec = h('div', { class: 'drawer-section' },
    f && f.description ? h('div', null, h('h4', null, 'Description'), h('div', { class: 'muted', style: { marginBottom: '16px', userSelect: 'text' } }, f.description)) : null,
    h('h4', null, 'Notes'), notes);

  const lbHost = h('div');
  const lbSec = h('div', { class: 'drawer-section' }, h('h4', null, 'Leaderboard', h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost sm', style: { textTransform: 'none', letterSpacing: 0 }, onclick: () => openScenarioLeaderboard(d.name, meta.customName || d.name) }, 'Full leaderboard')), lbHost);
  scenarioLeaderboard(lbHost, { name: d.name, compact: true, max: 10, scope: state.config.steamId ? 'friends' : 'global' });

  const calcHost = h('div');
  const calcSec = h('div', { class: 'drawer-section' }, h('h4', null, 'Calculator', h('span', { class: 'spacer' }),
    h('span', { style: { textTransform: 'none', letterSpacing: 0 } }, 'score needed for a rank or leaderboard spot')), calcHost);
  scenarioCalculator(calcHost, { name: d.name, display: meta.customName || d.name, pb, benchmarks: d.benchmarks || [] });

  const recent = runs.slice(-12).reverse();
  const runsSec = recent.length ? h('div', { class: 'drawer-section' }, h('h4', null, 'Recent runs'),
    h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'When'), h('th', { class: 'r' }, 'Score'), h('th', { class: 'r' }, 'Accuracy'), h('th', { class: 'r' }, 'Sens'), h('th', { class: 'r' }, 'FOV'))),
      h('tbody', null, recent.map((r) => h('tr', { class: 'click ' + runRowClass(r), onclick: () => showRunDetail(r.file, meta.customName || d.name) },
        h('td', null, fmtDateTime(r.date), r.pb ? h('span', { class: 'badge gold', style: { marginLeft: '8px' } }, 'PB') : null),
        h('td', { class: 'r' }, h('b', null, fmtScore(r.score))), h('td', { class: 'r' }, fmtPct(r.accuracy)),
        h('td', { class: 'r muted' }, r.sens ? `${+r.sens.toFixed(2)} ${r.sensScale || ''}` : '—'), h('td', { class: 'r muted' }, r.fov || '—')))))) : null;

  const foot = h('div', { class: 'drawer-foot' },
    h('button', { class: 'btn primary lg', onclick: () => play(d.name, 'challenge') }, icon('play'), 'Play challenge'),
    h('button', { class: 'btn lg', onclick: () => play(d.name, 'freeplay') }, 'Freeplay'),
    h('div', { class: 'grow' }),
    h('button', { class: 'btn ghost', title: 'Export as .kpack', onclick: () => exportItems({ scenarios: [d.name], name: meta.customName || d.name }) }, icon('download'), 'Export'),
    f ? h('button', { class: 'btn ghost icon', title: 'Show file in Explorer', onclick: () => call('library.revealScenario', { name: d.name }) }, icon('folder')) : null);

  panel.replaceChildren(h('div', { class: 'drawer-scroll' }, hero, head, statsSec, historySec, lbSec, calcSec, benchSec, notesSec, runsSec), foot);
}

function kv(label, value) { return h('div', null, h('span', null, label), h('b', null, value)); }
