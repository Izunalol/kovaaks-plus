import { call } from '../rpc.js';
import { h, icon, toast, modal, confirmBox, toggle, thumb, mediaUrl, isVideo, fmtDate, debounce, dropZone, saveMediaFile } from '../ui.js';
import { state } from '../state.js';
import { exportItems } from './packs.js';

const CAT_LABELS = {
  sens: 'Sensitivity', fov: 'Field of view', crosshair: 'Crosshair', visuals: 'Colors & visuals', audio: 'Audio',
  graphics: 'Graphics', hud: 'HUD', theme: 'Theme', gameplay: 'Gameplay',
};
const CAT_ICONS = { sens: 'target', fov: 'eye', crosshair: 'target', visuals: 'image', audio: 'bolt', graphics: 'layers', hud: 'grid', theme: 'sliders', gameplay: 'settings' };

// Friendly labels for the settings people touch most; everything else is shown by its KovaaK's key.
const LABELS = {
  XSens: ['Horizontal sensitivity'], YSens: ['Vertical sensitivity'], DPI: ['Mouse DPI', 'Used for cm/360 & in/360 scales'],
  SensScaleString: ['Sensitivity scale', 'Which game\'s sensitivity units to use'], FOV: ['Field of view'], FOVScaleString: ['FOV scale'],
  CrosshairFile: ['Crosshair image'], CrosshairScale: ['Crosshair scale'], CrosshairColor: ['Crosshair color'],
  CurrentThemeName: ['UI theme'], MasterVolume: ['Master volume'], MaxFPS: ['Max FPS (in game)'], MenuMaxFPS: ['Max FPS (menus)'],
  HideGun: ['Hide weapon model'], WeaponHidden: ['Hide weapon (weapon settings)'], PauseOnLossOfFocus: ['Pause when the game loses focus', 'Recommended ON so switching to Kovaak\'s Plus pauses the run'],
  EnemyBodyColor: ['Enemy body color'], EnemyHeadColor: ['Enemy head color'], ShowHealthBars: ['Show health bars'],
  CountDownBeforeChallengeStart: ['Countdown before challenge (s)'], Gamma: ['Gamma'], ResolutionScale: ['Resolution scale (%)'],
  SaveStatistics: ['Save run statistics', 'Must be ON for Kovaak\'s Plus to see your runs'], SkipPlaylistChallengeResults: ['Skip playlist results screens'],
  HitVolume: ['Hit sound volume'], KillConfirmedSound: ['Kill sound'], SpawnSound: ['Spawn sound'], BodyHitSound: ['Hit sound (weapon)'],
};
const PRIORITY = ['XSens', 'YSens', 'SensScaleString', 'DPI', 'FOV', 'FOVScaleString', 'CrosshairFile', 'CrosshairScale', 'CrosshairColor', 'CurrentThemeName', 'MasterVolume', 'PauseOnLossOfFocus', 'SaveStatistics'];

const SECTION_TYPE = { booleanSettings: 'bool', integerSettings: 'int', floatSettings: 'float', stringSettings: 'string', vectorSettings: 'vector', colorSettings: 'color' };

const short = (k) => { const i = k.indexOf('::'); return i >= 0 ? k.slice(i + 2) : k; };
const humanize = (k) => short(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

// Mirror of SettingsManager.Category on the C# side.
function category(key) {
  const k = short(key);
  if (/^(XSens|YSens|DPI|SensScaleString|SensitivityScaleTargetEnum|BaseIncrement|YInvert|ToggleADS|ZoomSensMultiplier|AutoScaleZoomSens|SensRandomizer_.*)$/.test(k)) return 'sens';
  if (/^(FOV|FOVScaleString|FOVScalarTargetEnum|FILMSCustom.*|CustomFOVYawMult|CustomYaw|ADSZoomFOV|ZoomFOVMultiplier|HipfireCustomFOV.*|ADSCustomFOV.*|FOVScale|ADSFOVScale)$/.test(k)) return 'fov';
  if (/^(Crosshair.*|Hitmarker.*|HeadHitmarker.*|Hitmarkers|HeadHitmarkers|ShowBloom|BloomMultiplier)$/.test(k)) return 'crosshair';
  if (k === 'CurrentThemeName') return 'theme';
  if (/(Volume|Pitch|Sound|Sounds)/i.test(k) || k.startsWith('Miss')) return 'audio';
  if (/^(Anisotropy|AntiAliasing.*|Shadows|PostProcessing|Effects|MaxFPS|MenuMaxFPS|ResolutionScale|Gamma|TextureStreaming|LowLatencyMode|SceneColorFormat|CloudCover|TiledReflections|OneFrameThreadLag|InputLagFrameCount|UseMeshInstancesInKmc|CacheDuration)$/.test(k)) return 'graphics';
  if (/^(HiddenUiElementsMask|ShowVersionDuringGameplay|ShowInfoBars|ShowSessionBestOnHighScoreBar|HighScoreFadeout|UIAnimationSpeed|ScoreGraphHistoryLength|SessionStatsMode|ChallengeHistogramStats|ChallengeResults.*|LatencyFlashIndicator|FloatingCombatText|ShowBotProfileOnHealthbar)$/.test(k)) return 'hud';
  if (/^(Enemy|Team|Wall|Floor|Ceiling|Ramp|Sky|Solid|OnHit|OnLookAt|Override|ChangeEnemy|BoundingBox|HideGibs|HideGun|WeaponHidden|ShowHealthBars|AutoHideHealthbar|DecalTime|ProjectileMarkerScale|BarSize|ShowSun|DeathCam|Tracer|WeaponModel|WeaponSkin|OverrideWeapon|ProjectileGraphic)/i.test(k) || k.endsWith('Material')) return 'visuals';
  return 'gameplay';
}

// Colour helpers: vectors are 0–1 floats, colors are 0–255 ints, weapon ini uses "X=0.9 Y=0.0 Z=0.0".
const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const vecToHex = (v) => '#' + hex2(v.x * 255) + hex2(v.y * 255) + hex2(v.z * 255);
const hexToVec = (hx) => ({ x: +(parseInt(hx.slice(1, 3), 16) / 255).toFixed(4), y: +(parseInt(hx.slice(3, 5), 16) / 255).toFixed(4), z: +(parseInt(hx.slice(5, 7), 16) / 255).toFixed(4) });
const iniToVec = (s) => { const m = /X=([\d.\-]+)\s+Y=([\d.\-]+)\s+Z=([\d.\-]+)/.exec(s || ''); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null; };
const vecToIni = (v) => `X=${v.x.toFixed(3)} Y=${v.y.toFixed(3)} Z=${v.z.toFixed(3)}`;

let tab = 'presets';

export async function render(page) {
  const body = h('div');
  const tabs = h('div', { class: 'settings-tabs' });
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings & Presets'),
    h('div', { class: 'sub' }, 'Edit KovaaK\'s settings directly and save them as presets you can swap or share. Your current settings are backed up before every change.'))), tabs, body);
  const drawTabs = () => tabs.replaceChildren(
    ...[['presets', 'Presets'], ['live', 'Current settings'], ['backups', 'Backups']].map(([id, label]) => h('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; drawTabs(); show(); } }, label)));
  const show = () => { body.replaceChildren(); (tab === 'live' ? renderLive : tab === 'backups' ? renderBackups : renderPresets)(body); };
  drawTabs();
  show();
}

// ------------------------------------------------------------------ apply helper
async function withRestart(method, params, label) {
  let res = await call(method, params);
  if (res && res.needsRestart) {
    const ok = await confirmBox('KovaaK\'s is running', 'KovaaK\'s only reads settings at startup and overwrites them when it closes. Kovaak\'s Plus will close the game, apply your changes and relaunch it.', 'Close, apply & relaunch');
    if (!ok) return false;
    res = await call(method, { ...params, restart: true });
  }
  toast(res.relaunched ? `${label}: relaunching KovaaK's…` : `${label}`, 'ok');
  return true;
}

// ------------------------------------------------------------------ presets
async function renderPresets(body) {
  body.append(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto' } })));
  let presets;
  try { presets = await call('presets.list'); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
  body.replaceChildren(
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onclick: () => captureDialog(() => renderPresetsAgain()) }, icon('plus'), 'New preset from current settings'),
      h('div', { class: 'grow' }),
      h('span', { class: 'result-count' }, `${presets.length} preset${presets.length === 1 ? '' : 's'}`)),
    presets.length ? h('div', { class: 'preset-grid' }, presets.map((p) => presetCard(p, renderPresetsAgain)))
      : h('div', { class: 'card empty' }, icon('sliders'), h('b', null, 'No presets yet'),
        'Capture your current sensitivity, crosshair, colors and more as a preset, then switch setups in one click or share them with friends.'));
  function renderPresetsAgain() { body.replaceChildren(); renderPresets(body); }
}

function presetSpecs(p) {
  const f = p.primary.floatSettings || {}, s = p.primary.stringSettings || {}, i = p.primary.integerSettings || {};
  const sens = f['EFloatSettingId::XSens'];
  return {
    sens: sens != null ? `${+sens.toFixed(3)} ${s['EStringSettingId::SensScaleString'] || ''}` : null,
    dpi: i['EIntegerSettingId::DPI'],
    fov: f['EFloatSettingId::FOV'] != null ? `${f['EFloatSettingId::FOV']} ${s['EStringSettingId::FOVScaleString'] || ''}` : null,
    crosshair: p.weapon.CrosshairFile || p.crosshairFile,
    theme: p.themeName,
  };
}

function presetCard(p, refresh) {
  const sp = presetSpecs(p);
  const chUrl = p.crosshairData ? `data:image/png;base64,${p.crosshairData}` : (sp.crosshair ? `https://crosshair.kplus/${encodeURIComponent(sp.crosshair)}` : null);
  const top = p.thumbnail ? thumb(p.name, p.thumbnail) : (() => {
    const t = thumb(p.name, null);
    if (chUrl) { t.replaceChildren(h('div', { class: 'crosshair-preview', style: { width: '90px', height: '90px', background: 'rgba(0,0,0,.35)', border: 0 } }, h('img', { src: chUrl, style: { maxWidth: '70px', maxHeight: '70px' } }))); }
    return t;
  })();

  const apply = async () => { try { await withRestart('presets.apply', { id: p.id }, `Applied "${p.name}"`); } catch (e) { toast(e.message, 'error'); } };
  return h('div', { class: 'card preset-card' },
    top,
    h('div', { class: 'body' },
      h('div', { class: 'row' }, h('b', { class: 'grow ellipsis', style: { fontSize: '15px' } }, p.name), h('span', { class: 'small muted' }, fmtDate(p.updated))),
      p.description ? h('div', { class: 'small muted' }, p.description) : null,
      h('div', { class: 'chips' }, p.categories.map((c) => h('span', { class: 'chip sm', '--c': '#64748b' }, CAT_LABELS[c] || c))),
      h('div', { class: 'specs' },
        sp.sens ? h('span', null, 'Sens ', h('b', null, sp.sens)) : null,
        sp.dpi ? h('span', null, 'DPI ', h('b', null, sp.dpi)) : null,
        sp.fov ? h('span', null, 'FOV ', h('b', null, sp.fov)) : null,
        sp.crosshair ? h('span', { class: 'ellipsis' }, 'Crosshair ', h('b', null, sp.crosshair.replace(/\.png$/i, ''))) : null,
        sp.theme ? h('span', { class: 'ellipsis', style: { gridColumn: 'span 2' } }, 'Theme ', h('b', null, sp.theme)) : null),
      h('div', { class: 'grow' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm grow', onclick: apply }, icon('check'), 'Apply'),
        h('button', { class: 'btn sm icon', title: 'Edit name, description & images', onclick: () => editPreset(p, refresh) }, icon('edit')),
        h('button', { class: 'btn sm icon', title: 'Update from current settings', onclick: async () => {
          if (!await confirmBox('Update preset?', `Replace the values in "${p.name}" with your current KovaaK's settings (same categories)?`, 'Update')) return;
          await call('presets.recapture', { id: p.id }); toast('Preset updated', 'ok'); refresh();
        } }, icon('refresh')),
        h('button', { class: 'btn sm icon', title: 'Export preset', onclick: () => exportItems({ presets: [p.id], name: p.name }) }, icon('download')),
        h('button', { class: 'btn sm icon', title: 'Delete', onclick: async () => {
          if (!await confirmBox('Delete preset?', `"${p.name}" will be deleted. Your KovaaK's settings are not affected.`, 'Delete', 'danger')) return;
          await call('presets.delete', { id: p.id }); refresh();
        } }, icon('trash')))));
}

function captureDialog(done) {
  const name = h('input', { class: 'input', placeholder: 'e.g. Tracking 40cm, Valorant clicking…' });
  const desc = h('textarea', { class: 'input', placeholder: 'Optional description', style: { minHeight: '60px' } });
  const chosen = new Set(['sens', 'fov', 'crosshair', 'visuals', 'audio', 'theme']);
  const cats = h('div', { class: 'chips' });
  const drawCats = () => cats.replaceChildren(...Object.entries(CAT_LABELS).map(([k, l]) =>
    h('span', { class: 'chip btnlike ' + (chosen.has(k) ? 'on' : 'off'), '--c': 'var(--accent)', onclick: () => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); drawCats(); } }, l)));
  drawCats();
  modal({
    title: 'New preset from current settings',
    body: h('div', { class: 'col', style: { gap: '14px' } },
      h('label', { class: 'field' }, 'Name', name),
      h('label', { class: 'field' }, 'Description', desc),
      h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--text-2)' } }, 'Include'), cats,
        h('span', { class: 'field-hint' }, 'Only the selected categories are saved and applied, so a "Crosshair" preset won\'t touch your sensitivity.'))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Create preset', kind: 'primary', onClick: async () => {
        if (!name.value.trim()) { toast('Give it a name'); return false; }
        if (!chosen.size) { toast('Pick at least one category'); return false; }
        try { await call('presets.capture', { name: name.value.trim(), description: desc.value.trim() || null, categories: [...chosen] }); toast('Preset created', 'ok'); done(); }
        catch (e) { toast(e.message, 'error'); return false; }
      },
    }],
  });
}

function editPreset(p, refresh) {
  const name = h('input', { class: 'input', value: p.name });
  const desc = h('textarea', { class: 'input', style: { minHeight: '60px' } }, p.description || '');
  let thumbName = p.thumbnail, previewName = p.preview;
  const media = h('div', { class: 'row' });
  const drawMedia = () => media.replaceChildren(
    dropZone(h('div', { class: 'drop-target', title: 'Drop an image here', style: { width: '160px', borderRadius: '8px', overflow: 'hidden' } }, thumb(p.name, thumbName)), async (file) => { try { thumbName = await saveMediaFile(file, 'preset:' + p.name, 'thumbnail'); drawMedia(); } catch (e) { toast(e.message, 'error'); } }, 'media'),
    h('div', { class: 'col' },
      h('button', { class: 'btn sm', onclick: async () => { const f = await call('media.pick', { kind: 'image', owner: 'preset:' + p.name, target: 'thumbnail' }); if (f) { thumbName = f; drawMedia(); } } }, icon('image'), 'Set thumbnail'),
      h('button', { class: 'btn sm', onclick: async () => { const f = await call('media.pick', { kind: 'video', owner: 'preset:' + p.name, target: 'preview' }); if (f) { previewName = f; drawMedia(); } } }, icon('film'), previewName ? 'Change preview' : 'Set preview'),
      thumbName || previewName ? h('button', { class: 'btn ghost sm', onclick: () => { thumbName = null; previewName = null; drawMedia(); } }, 'Remove images') : null));
  drawMedia();
  modal({
    title: 'Edit preset',
    body: h('div', { class: 'col', style: { gap: '14px' } }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Description', desc), media,
      previewName ? (isVideo(previewName) ? h('video', { src: mediaUrl(previewName), autoplay: true, muted: true, loop: true, style: { width: '100%', borderRadius: '10px' } }) : h('img', { src: mediaUrl(previewName), style: { width: '100%', borderRadius: '10px' } })) : null),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: async () => {
      await call('presets.save', { id: p.id, name: name.value.trim() || p.name, description: desc.value.trim() || null, thumbnail: thumbName, preview: previewName });
      refresh();
    } }],
  });
}

// ------------------------------------------------------------------ live settings editor
let liveCat = 'sens';

async function renderLive(body) {
  body.append(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto' } })));
  let snap;
  try { snap = await call('settings.get'); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }

  const primary = snap.primary;
  const weapon = snap.weapon;
  const pending = { primary: {}, weapon: {} };
  const count = () => Object.values(pending.primary).reduce((a, s) => a + Object.keys(s).length, 0) + Object.keys(pending.weapon).length;

  // Flatten all settings into rows.
  const rows = [];
  for (const [section, type] of Object.entries(SECTION_TYPE)) {
    for (const [key, value] of Object.entries(primary[section] || {})) {
      rows.push({ src: 'primary', section, key, value, type, cat: type === 'vector' || type === 'color' ? (category(key) === 'gameplay' ? 'visuals' : category(key)) : category(key) });
    }
  }
  for (const [key, value] of Object.entries(weapon)) {
    const vec = iniToVec(value);
    const type = vec ? 'inivector' : /^(true|false)$/i.test(value) ? 'inibool' : /^-?\d+(\.\d+)?$/.test(value) ? 'ininum' : 'inistring';
    rows.push({ src: 'weapon', key, value, type, cat: category(key) });
  }

  const search = h('input', { class: 'input', placeholder: 'Search all settings…' });
  const catNav = h('div', { class: 'filter-list' });
  const list = h('div');
  const applyBar = h('div', { class: 'apply-bar hidden' });

  body.replaceChildren(
    snap.running ? h('div', { class: 'card pad row', style: { marginBottom: '14px', borderColor: 'color-mix(in srgb, var(--gold) 40%, transparent)' } }, icon('bolt'),
      h('div', null, h('b', null, 'KovaaK\'s is running. '), h('span', { class: 'muted' }, 'When you apply, Kovaak\'s Plus closes the game, writes your changes and relaunches it.'))) : null,
    h('div', { class: 'lib-layout' },
      h('div', { class: 'filters' }, h('div', { class: 'search' }, icon('search'), search), catNav),
      h('div', { class: 'card pad' }, list, applyBar)));

  search.addEventListener('input', debounce(drawList, 120));

  function drawNav() {
    const counts = {};
    rows.forEach((r) => { counts[r.cat] = (counts[r.cat] || 0) + 1; });
    catNav.replaceChildren(...Object.keys(CAT_LABELS).filter((c) => counts[c]).map((c) =>
      h('div', { class: 'filter-item' + (liveCat === c && !search.value ? ' on' : ''), onclick: () => { liveCat = c; search.value = ''; drawNav(); drawList(); } },
        icon(CAT_ICONS[c]), CAT_LABELS[c], h('span', { class: 'count' }, counts[c]))));
  }

  function setPending(r, v) {
    if (r.src === 'primary') {
      (pending.primary[r.section] ||= {})[r.key] = v;
      if (JSON.stringify(v) === JSON.stringify(r.value)) { delete pending.primary[r.section][r.key]; }
    } else {
      pending.weapon[r.key] = v;
      if (v === r.value) delete pending.weapon[r.key];
    }
    const el = list.querySelector(`[data-key="${CSS.escape(r.src + ':' + r.key)}"]`);
    if (el) el.classList.toggle('changed', isChanged(r));
    drawApply();
  }
  const isChanged = (r) => r.src === 'primary' ? (pending.primary[r.section] && r.key in pending.primary[r.section]) : r.key in pending.weapon;
  const current = (r) => r.src === 'primary' ? (pending.primary[r.section] && r.key in pending.primary[r.section] ? pending.primary[r.section][r.key] : r.value) : (r.key in pending.weapon ? pending.weapon[r.key] : r.value);

  function control(r) {
    const v = current(r);
    const k = short(r.key);
    const numIn = (val, step, parse) => { const i = h('input', { class: 'input num', type: 'number', step, value: val }); i.addEventListener('change', () => setPending(r, parse(i.value))); return i; };
    const select = (opts, val, map = (x) => x) => {
      const all = opts.includes(val) ? opts : [val, ...opts];
      const s = h('select', { class: 'input' }, all.map((o) => h('option', { value: o, selected: o === val }, o)));
      s.addEventListener('change', () => setPending(r, map(s.value)));
      return s;
    };
    if (k === 'SensScaleString' || k === 'FOVScaleString' || k === 'OverrideSensScaleString' || k === 'OverrideFovScaleString') return select(snap.scales, v);
    if (k === 'CurrentThemeName') return select(snap.themes, v);
    if (k === 'CrosshairFile' || k === 'HitmarkerFile' || k === 'HeadHitmarkerFile') return crosshairPicker(snap.crosshairs, v, (x) => setPending(r, x));
    if (/Sound$/.test(k) && (r.type === 'string' || r.type === 'inistring') && snap.sounds.length) return select(['None', ...snap.sounds], v);
    if (/Volume$/.test(k) && (r.type === 'float' || r.type === 'ininum')) {
      const num = r.type === 'ininum' ? parseFloat(v) : v;
      const lab = h('span', { class: 'num small muted', style: { width: '38px', textAlign: 'right' } }, Math.round(num * 100) + '%');
      const sl = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: num, style: { width: '100%', accentColor: 'var(--accent)' } });
      sl.addEventListener('input', () => { lab.textContent = Math.round(sl.value * 100) + '%'; });
      sl.addEventListener('change', () => setPending(r, r.type === 'ininum' ? String(sl.value) : +sl.value));
      return h('div', { class: 'row', style: { width: '100%' } }, sl, lab);
    }
    switch (r.type) {
      case 'bool': return toggle(v, (x) => setPending(r, x));
      case 'inibool': return toggle(/true/i.test(v), (x) => setPending(r, x ? 'true' : 'false'));
      case 'int': return numIn(v, 1, (x) => parseInt(x, 10) || 0);
      case 'float': return numIn(v, 'any', (x) => parseFloat(x) || 0);
      case 'ininum': return numIn(v, 'any', (x) => x);
      case 'string': case 'inistring': { const i = h('input', { class: 'input', value: v }); i.addEventListener('change', () => setPending(r, i.value)); return i; }
      case 'vector': case 'inivector': {
        const vec = r.type === 'vector' ? v : iniToVec(v);
        const c = h('input', { type: 'color', class: 'color-in', value: vecToHex(vec) });
        c.addEventListener('input', () => setPending(r, r.type === 'vector' ? hexToVec(c.value) : vecToIni(hexToVec(c.value))));
        return c;
      }
      case 'color': {
        const c = h('input', { type: 'color', class: 'color-in', value: '#' + hex2(v.r) + hex2(v.g) + hex2(v.b) });
        c.addEventListener('input', () => setPending(r, { r: parseInt(c.value.slice(1, 3), 16), g: parseInt(c.value.slice(3, 5), 16), b: parseInt(c.value.slice(5, 7), 16), a: v.a ?? 255 }));
        return c;
      }
    }
    return h('span', { class: 'muted small' }, JSON.stringify(v));
  }

  function drawList() {
    const q = search.value.trim().toLowerCase();
    let shown = q ? rows.filter((r) => (short(r.key) + ' ' + humanize(r.key) + ' ' + (LABELS[short(r.key)]?.[0] || '')).toLowerCase().includes(q)) : rows.filter((r) => r.cat === liveCat);
    shown = shown.sort((a, b) => {
      const pa = PRIORITY.indexOf(short(a.key)), pb = PRIORITY.indexOf(short(b.key));
      return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb) || humanize(a.key).localeCompare(humanize(b.key));
    });
    drawNav();
    list.replaceChildren(
      h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h3', { style: { margin: 0 } }, q ? `Results for "${search.value}"` : CAT_LABELS[liveCat]), h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: () => captureDialog(() => toast('Preset created: see the Presets tab', 'ok')) }, icon('plus'), 'Save as preset')),
      ...shown.map((r) => {
        const k = short(r.key);
        const [label, hint] = LABELS[k] || [humanize(r.key)];
        return h('div', { class: 'set-row' + (isChanged(r) ? ' changed' : ''), 'data-key': r.src + ':' + r.key },
          h('div', { class: 'k' }, label, h('small', null, hint || (r.src === 'weapon' ? `weaponsettings.ini · ${k}` : k))),
          h('div', { class: 'ctl' }, control(r)));
      }),
      shown.length ? null : h('div', { class: 'empty' }, 'No settings match.'));
  }

  function drawApply() {
    const n = count();
    applyBar.classList.toggle('hidden', !n);
    applyBar.replaceChildren(
      h('b', null, `${n} unsaved change${n === 1 ? '' : 's'}`), h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => { pending.primary = {}; pending.weapon = {}; drawList(); drawApply(); } }, 'Discard'),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          const ok = await withRestart('settings.apply', { primary: pending.primary, weapon: pending.weapon }, 'Settings applied');
          if (ok) { body.replaceChildren(); renderLive(body); }
        } catch (e) { toast(e.message, 'error'); }
      } }, icon('check'), 'Apply to KovaaK\'s'));
  }

  drawList();
}

function crosshairPicker(files, value, onPick) {
  const preview = h('div', { class: 'crosshair-preview' }, value ? h('img', { src: `https://crosshair.kplus/${encodeURIComponent(value)}` }) : null);
  const label = h('span', { class: 'small ellipsis', style: { maxWidth: '120px' } }, value || 'None');
  const btn = h('button', { class: 'btn sm' }, 'Choose');
  btn.onclick = () => {
    const m = modal({
      title: 'Choose a crosshair', wide: true,
      body: h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: '10px' } }, files.map((f) =>
        h('div', { class: 'col', style: { alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '8px', borderRadius: '10px', border: '1px solid ' + (f === value ? 'var(--accent)' : 'transparent') },
          onclick: () => { value = f; onPick(f); preview.replaceChildren(h('img', { src: `https://crosshair.kplus/${encodeURIComponent(f)}` })); label.textContent = f; m.close(); } },
          h('div', { class: 'crosshair-preview', style: { width: '64px', height: '64px' } }, h('img', { src: `https://crosshair.kplus/${encodeURIComponent(f)}`, loading: 'lazy' })),
          h('span', { class: 'small muted ellipsis', style: { maxWidth: '86px' } }, f.replace(/\.png$/i, ''))))),
    });
  };
  return h('div', { class: 'row' }, preview, label, btn);
}

// ------------------------------------------------------------------ backups
async function renderBackups(body) {
  const list = await call('settings.backups').catch(() => []);
  body.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'muted' }, 'A snapshot of PrimaryUserSettings.json, weaponsettings.ini and UI.json is saved before every change (last 40 kept).'), h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => call('app.reveal', { what: 'backups' }) }, icon('folder'), 'Open folder')),
    list.length ? h('div', { class: 'card' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Snapshot'), h('th', null, 'Created'), h('th'))),
      h('tbody', null, list.map((b) => h('tr', null,
        h('td', null, b.id.replace(/^\d{8}-\d{6}-?/, '').replace(/_/g, ' ') || 'snapshot'),
        h('td', { class: 'muted' }, new Date(b.created).toLocaleString()),
        h('td', { class: 'r' }, h('button', { class: 'btn sm', onclick: async () => {
          if (!await confirmBox('Restore this backup?', 'Your current settings will be backed up first, then replaced with this snapshot.', 'Restore')) return;
          try { await withRestart('settings.restore', { id: b.id }, 'Backup restored'); } catch (e) { toast(e.message, 'error'); }
        } }, 'Restore'))))))) : h('div', { class: 'card empty' }, 'No backups yet. One is made automatically the first time you change settings.'));
}
