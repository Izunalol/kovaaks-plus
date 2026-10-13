// Tag picker (assign tags), tag editor and tag manager (create / rename / recolor / group / thumbnail / preset / delete).
import { call } from './rpc.js';
import { h, icon, modal, tagChip, confirmBox, toast, contextMenu, thumb, dropZone, saveMediaFile, mediaUrl, tagIcon } from './ui.js';

const TAG_ICONS = ['target', 'crosshair', 'dot', 'circle', 'square', 'triangle', 'diamond', 'hexagon', 'bolt', 'fire', 'star', 'sparkle', 'wave', 'zigzag', 'move', 'mouse', 'hand', 'eye', 'gauge', 'clock', 'trophy', 'medal', 'flag', 'heart', 'shield', 'snowflake', 'layers', 'chart'];
import { state, setTags } from './state.js';
import { splitThumb } from './thumbs.js';
import { pickPreset, presetName, loadPresets } from './play.js';

/** Edit one tag: name, colour, category, default thumbnail, default preset, or delete it. */
export async function editTag(tag) {
  if (!state.presets) await loadPresets();
  const t = { ...tag };
  const groups = [...new Set([...state.groups, ...state.tags.map((x) => x.group)])];
  const name = h('input', { class: 'input', value: t.name });
  const group = h('select', { class: 'input' }, groups.map((g) => h('option', { value: g, selected: g === t.group }, g)), h('option', { value: '__new' }, 'New category…'));
  const newGroup = h('input', { class: 'input hidden', placeholder: 'New category name' });
  group.addEventListener('change', () => newGroup.classList.toggle('hidden', group.value !== '__new'));
  const color = h('input', { type: 'color', class: 'color-in', value: t.color });
  const swatches = h('div', { class: 'row', style: { gap: '5px', flexWrap: 'wrap' } }, SWATCHES.map((c) =>
    h('button', { style: { width: '20px', height: '20px', borderRadius: '50%', border: 0, background: c, cursor: 'pointer' }, onclick: () => { color.value = c; t.color = c; drawPreview(); } })));
  color.addEventListener('input', () => { t.color = color.value; drawPreview(); });
  const preview = h('div');
  const drawPreview = () => preview.replaceChildren(tagChip({ ...t, name: name.value || 'Tag' }));
  name.addEventListener('input', drawPreview);

  const owner = () => 'tag:' + (name.value.trim() || t.name);
  const media = h('div', { class: 'row', style: { alignItems: 'flex-start' } });
  const drawMedia = () => {
    const box = h('div', { class: 'tag-thumb-edit drop-target', title: 'Drop an image, GIF or clip here' }, t.thumbnail ? splitThumb([t.thumbnail], null) : thumb(t.name || 'Tag', null, t.color));
    dropZone(box, async (file) => { try { t.thumbnail = await saveMediaFile(file, owner(), 'thumbnail'); drawMedia(); } catch (e) { toast(e.message, 'error'); } }, 'media');
    media.replaceChildren(box,
      h('div', { class: 'col', style: { gap: '6px' } },
        h('button', { class: 'btn sm', onclick: async () => { const f = await call('media.pick', { kind: 'video', owner: owner(), target: 'thumbnail' }).catch((e) => toast(e.message, 'error')); if (f) { t.thumbnail = f; drawMedia(); } } }, icon('image'), t.thumbnail ? 'Change thumbnail' : 'Set thumbnail'),
        t.thumbnail ? h('button', { class: 'btn ghost sm', onclick: () => { t.thumbnail = null; drawMedia(); } }, 'Remove') : null,
        h('div', { class: 'small muted', style: { maxWidth: '240px' } }, 'Drop a file on the preview or pick one. Scenarios with this tag and no thumbnail of their own use it; with several tagged thumbnails the card is split between them.')));
  };

  // Sidebar icon: colour dot, a built-in icon, or your own small image.
  const iconRow = h('div', { class: 'col', style: { gap: '8px' } });
  const drawIcon = () => {
    const custom = t.icon && !t.icon.startsWith('ic:');
    const upload = h('button', { class: 'icon-opt' + (custom ? ' on' : ''), title: 'Upload an image (or drop one here)', onclick: async () => {
      const f = await call('media.pick', { kind: 'image', owner: owner(), target: 'icon' }).catch((e) => toast(e.message, 'error'));
      if (f) { t.icon = f; drawIcon(); drawPreview(); }
    } }, custom ? h('img', { src: mediaUrl(t.icon) }) : icon('upload'));
    dropZone(upload, async (file) => { try { t.icon = await saveMediaFile(file, owner(), 'icon'); drawIcon(); drawPreview(); } catch (e) { toast(e.message, 'error'); } });
    iconRow.replaceChildren(h('div', { class: 'icon-grid' },
      h('button', { class: 'icon-opt' + (!t.icon ? ' on' : ''), title: 'Colour dot', onclick: () => { t.icon = null; drawIcon(); drawPreview(); } }, h('span', { class: 'sw', style: { background: t.color, width: '12px', height: '12px', borderRadius: '3px' } })),
      ...TAG_ICONS.map((n) => h('button', { class: 'icon-opt' + (t.icon === 'ic:' + n ? ' on' : ''), title: n, style: { color: t.color }, onclick: () => { t.icon = 'ic:' + n; drawIcon(); drawPreview(); } }, icon(n))),
      upload));
  };
  const presetBtn = h('button', { class: 'btn sm' });
  const drawPreset = () => presetBtn.replaceChildren(icon('sliders'), t.preset ? (presetName(t.preset) || 'Missing preset') : 'None');
  presetBtn.onclick = async () => { const id = await pickPreset(`Default preset for "${t.name}"`, t.preset, 'Scenarios with this tag play with your current settings'); if (id != null) { t.preset = id || null; drawPreset(); } };
  drawPreview(); drawMedia(); drawPreset(); drawIcon();
  color.addEventListener('change', drawIcon);

  const count = state.scenarios.filter((s) => s.tags.includes(t.id)).length;
  modal({
    title: 'Edit tag',
    body: h('div', { class: 'col', style: { gap: '14px' } },
      h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Name', name), h('div', { style: { paddingTop: '18px' } }, preview)),
      h('label', { class: 'field' }, 'Category', group, newGroup),
      h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--text-2)' } }, 'Colour'), h('div', { class: 'row' }, color, swatches)),
      h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--text-2)' } }, 'Sidebar icon'), iconRow),
      h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--text-2)' } }, 'Default thumbnail'), media),
      h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--text-2)' } }, 'Default settings preset'), h('div', { class: 'row' }, presetBtn,
        h('span', { class: 'small muted' }, 'Used when a tagged scenario has no preset of its own.'))),
      h('div', { class: 'small muted' }, `Used by ${count} scenario${count === 1 ? '' : 's'}.`)),
    actions: [
      { label: 'Delete tag', kind: 'danger', onClick: async () => {
        if (!await confirmBox('Delete tag?', `"${t.name}" will be removed from ${count} scenario${count === 1 ? '' : 's'}.`, 'Delete', 'danger')) return false;
        await setTags(state.tags.filter((x) => x.id !== t.id), state.groups);
        toast('Tag deleted', 'ok');
      } },
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Save', kind: 'primary', onClick: async () => {
        t.name = name.value.trim();
        if (!t.name) { toast('Give the tag a name'); return false; }
        if (state.tags.some((x) => x.id !== t.id && x.name.toLowerCase() === t.name.toLowerCase())) { toast('Another tag already has that name'); return false; }
        t.group = group.value === '__new' ? (newGroup.value.trim() || 'Custom') : group.value;
        const groupsNext = state.groups.includes(t.group) ? state.groups : [...state.groups, t.group];
        await setTags(state.tags.map((x) => (x.id === t.id ? t : x)), groupsNext);
        toast('Tag saved', 'ok');
      } },
    ],
  });
}

/** Right-click menu for a tag (filter list, chips). */
export function tagMenu(e, tag, extra = []) {
  contextMenu(e, [
    { header: tag.name },
    { label: 'Edit tag…', icon: 'edit', onClick: () => editTag(tag) },
    ...extra,
    { sep: true },
    { label: 'Manage all tags…', icon: 'tag', onClick: () => openTagManager() },
    { label: 'Delete tag', icon: 'trash', danger: true, onClick: async () => {
      const count = state.scenarios.filter((s) => s.tags.includes(tag.id)).length;
      if (!await confirmBox('Delete tag?', `"${tag.name}" will be removed from ${count} scenario${count === 1 ? '' : 's'}.`, 'Delete', 'danger')) return;
      await setTags(state.tags.filter((x) => x.id !== tag.id), state.groups);
    } },
  ]);
}

const SWATCHES = ['#f97316', '#fb923c', '#facc15', '#a3e635', '#4ade80', '#22c55e', '#2dd4bf', '#22d3ee', '#38bdf8', '#60a5fa', '#818cf8', '#8b5cf6', '#c084fc', '#e879f9', '#f472b6', '#f87171', '#dc2626', '#94a3b8'];

/** Grouped toggle-chip picker. Returns an element; calls onChange(selectedIds) on every toggle. */
export function tagPicker(selected, onChange, opts = {}) {
  const sel = new Set(selected);
  const root = h('div', { class: 'col', style: { gap: '14px' } });
  const draw = () => {
    root.replaceChildren();
    const groups = [...state.groups];
    state.tags.forEach((t) => { if (!groups.includes(t.group)) groups.push(t.group); });
    for (const g of groups) {
      const tags = state.tags.filter((t) => t.group === g);
      if (!tags.length) continue;
      root.append(h('div', null,
        h('div', { class: 'small muted', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '7px' } }, g),
        h('div', { class: 'chips' }, tags.map((t) => tagChip(t, {
          cls: 'btnlike ' + (sel.has(t.id) ? 'on' : 'off'),
          onClick: () => { sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); onChange([...sel]); draw(); },
        })))));
    }
    if (opts.allowCreate !== false) {
      const name = h('input', { class: 'input', placeholder: 'New tag name', style: { flex: 1 } });
      const group = h('select', { class: 'input', style: { width: '150px' } }, groups.map((g) => h('option', { value: g }, g)), h('option', { value: '__new' }, 'New group…'));
      const add = async () => {
        const n = name.value.trim();
        if (!n) return;
        let g = group.value;
        if (g === '__new') { g = prompt('Group name') || 'Custom'; }
        if (state.tags.some((t) => t.name.toLowerCase() === n.toLowerCase())) { toast('That tag already exists'); return; }
        const tag = { id: Math.random().toString(36).slice(2, 10), name: n, group: g, color: SWATCHES[state.tags.length % SWATCHES.length] };
        const groupsNext = state.groups.includes(g) ? state.groups : [...state.groups, g];
        await setTags([...state.tags, tag], groupsNext);
        sel.add(tag.id);
        onChange([...sel]);
        draw();
      };
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      root.append(h('div', { class: 'row', style: { marginTop: '4px' } }, name, group, h('button', { class: 'btn', onclick: add }, icon('plus'), 'Create')));
    }
  };
  draw();
  return root;
}

export function openTagPicker(title, selected, onSave) {
  let current = [...selected];
  modal({
    title,
    body: tagPicker(current, (ids) => { current = ids; }),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save tags', kind: 'primary', onClick: () => onSave(current) }],
  });
}

export function openTagManager() {
  let tags = state.tags.map((t) => ({ ...t }));
  let groups = [...state.groups];
  let dragging = null;
  const body = h('div', { class: 'col', style: { gap: '18px' } });

  /** Moves a tag into `group`, before `beforeTag` (or to the end of the group when null). Tag order = list order everywhere. */
  function moveTag(tag, beforeTag, group) {
    tags = tags.filter((x) => x !== tag);
    tag.group = group;
    let at;
    if (beforeTag && beforeTag !== tag) at = tags.indexOf(beforeTag);
    else {
      const last = tags.map((x) => x.group).lastIndexOf(group);
      at = last >= 0 ? last + 1 : tags.length;
    }
    tags.splice(at < 0 ? tags.length : at, 0, tag);
  }

  const draw = () => {
    body.replaceChildren();
    tags.forEach((t) => { if (!groups.includes(t.group)) groups.push(t.group); });
    for (const g of groups) {
      const list = tags.filter((t) => t.group === g);
      const gname = h('input', { class: 'input', value: g, style: { fontWeight: 700, width: '220px' } });
      gname.addEventListener('change', () => {
        const nv = gname.value.trim() || g;
        tags.forEach((t) => { if (t.group === g) t.group = nv; });
        groups = groups.map((x) => (x === g ? nv : x));
        draw();
      });
      const rows = list.map((t) => {
        const color = h('input', { type: 'color', class: 'color-in', value: t.color });
        color.addEventListener('input', () => { t.color = color.value; preview.style.setProperty('--c', t.color); });
        const name = h('input', { class: 'input grow', value: t.name });
        name.addEventListener('input', () => { t.name = name.value; preview.firstChild.textContent = t.name; });
        const groupSel = h('select', { class: 'input', style: { width: '150px' } }, groups.map((x) => h('option', { value: x, selected: x === t.group }, x)));
        groupSel.addEventListener('change', () => { t.group = groupSel.value; draw(); });
        const preview = tagChip(t);
        const thumbBtn = h('button', { class: 'btn sm icon' + (t.thumbnail ? ' primary' : ''), title: t.thumbnail ? 'Default thumbnail set (click or drop a file to change, right-click to remove)' : 'Set default thumbnail (click or drop a file)',
          onclick: async () => { const f = await call('media.pick', { kind: 'video', owner: 'tag:' + t.name, target: 'thumbnail' }).catch(() => null); if (f) { t.thumbnail = f; draw(); } },
          oncontextmenu: (e) => { e.preventDefault(); t.thumbnail = null; draw(); } }, icon('image'));
        dropZone(thumbBtn, async (file) => { try { t.thumbnail = await saveMediaFile(file, 'tag:' + t.name, 'thumbnail'); draw(); } catch (e) { toast(e.message, 'error'); } }, 'media');
        const presetBtn = h('button', { class: 'btn sm icon' + (t.preset ? ' primary' : ''), title: t.preset ? `Default preset: ${presetName(t.preset) || '?'}` : 'Set default preset',
          onclick: async () => { const id = await pickPreset(`Default preset for "${t.name}"`, t.preset); if (id != null) { t.preset = id || null; draw(); } } }, icon('sliders'));
        const li = list.indexOf(t);
        const handle = h('span', { class: 'drag-handle', title: 'Drag to reorder (or move to another group)' }, '⋮⋮');
        const row = h('div', { class: 'row tag-row' }, handle, tagIcon(t), color, name, groupSel, thumbBtn, presetBtn, h('div', { style: { width: '140px' } }, preview),
          h('button', { class: 'btn ghost icon sm', title: 'Move up', disabled: li === 0, onclick: () => { moveTag(t, list[li - 1], g); draw(); } }, icon('arrowUp')),
          h('button', { class: 'btn ghost icon sm', title: 'Move down', disabled: li === list.length - 1, onclick: () => { moveTag(t, list[li + 2] || null, g); draw(); } }, icon('arrowUp', 'flip-y')),
          h('button', { class: 'btn ghost icon sm', title: 'Delete tag', onclick: async () => {
            if (await confirmBox('Delete tag?', `"${t.name}" will be removed from every scenario.`, 'Delete', 'danger')) { tags = tags.filter((x) => x !== t); draw(); }
          } }, icon('trash')));
        // Drag only from the handle so the text inputs stay editable.
        handle.addEventListener('mousedown', () => { row.draggable = true; });
        row.addEventListener('dragstart', (e) => { dragging = t; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); });
        row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); dragging = null; });
        row.addEventListener('dragover', (e) => { if (!dragging || dragging === t) return; e.preventDefault(); const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; row.classList.toggle('drop-before', !after); row.classList.toggle('drop-after', after); });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
        row.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!dragging || dragging === t) return;
          const after = row.classList.contains('drop-after');
          moveTag(dragging, after ? (list[li + 1] === dragging ? list[li + 2] : list[li + 1]) || null : t, g);
          draw();
        });
        return row;
      });
      const gi = groups.indexOf(g);
      const groupBox = h('div', { class: 'col tag-group' },
        h('div', { class: 'row' }, gname, h('span', { class: 'muted small' }, `${list.length} tag${list.length === 1 ? '' : 's'}`),
          h('button', { class: 'btn ghost icon sm', title: 'Move group up', disabled: gi <= 0, onclick: () => { groups.splice(gi - 1, 0, groups.splice(gi, 1)[0]); draw(); } }, icon('arrowUp')),
          h('button', { class: 'btn ghost icon sm', title: 'Move group down', disabled: gi >= groups.length - 1, onclick: () => { groups.splice(gi + 1, 0, groups.splice(gi, 1)[0]); draw(); } }, icon('arrowUp', 'flip-y')),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn sm', onclick: () => { tags.push({ id: Math.random().toString(36).slice(2, 10), name: 'New tag', group: g, color: SWATCHES[tags.length % SWATCHES.length] }); draw(); } }, icon('plus'), 'Add tag'),
          !list.length ? h('button', { class: 'btn ghost sm', onclick: () => { groups = groups.filter((x) => x !== g); draw(); } }, 'Remove group') : null),
        ...rows,
        list.length ? null : h('div', { class: 'small muted', style: { padding: '8px 4px' } }, 'Drop tags here'));
      // Dropping on the group (not on a row) moves the tag to the end of this group.
      groupBox.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); groupBox.classList.add('drop-group'); } });
      groupBox.addEventListener('dragleave', (e) => { if (!groupBox.contains(e.relatedTarget)) groupBox.classList.remove('drop-group'); });
      groupBox.addEventListener('drop', (e) => { e.preventDefault(); if (dragging) { moveTag(dragging, null, g); draw(); } });
      body.append(groupBox);
    }
    body.append(h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, onclick: () => { groups.push('New group ' + (groups.length + 1)); draw(); } }, icon('plus'), 'Add group'));
  };
  draw();
  modal({
    title: 'Manage tags', wide: true, body,
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: async () => { await setTags(tags.filter((t) => t.name.trim()), groups); toast('Tags saved', 'ok'); } }],
  });
}
