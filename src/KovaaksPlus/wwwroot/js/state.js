// Global client-side state shared by all views.
import { call } from './rpc.js';

export const state = {
  config: {},
  version: '',
  valid: false,
  scenarios: [],        // library entries (see Api.BuildLibrary)
  byName: new Map(),
  tags: [],
  groups: [],
  game: { running: false, currentScenario: null },
  paused: false,
  statsReady: false,
  statsProgress: null,
  presets: null,
};

const subs = new Map();
export function subscribe(key, fn) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key).add(fn);
  return () => subs.get(key).delete(fn);
}
// Each listener is isolated: one failing view must not stop the others from updating.
export function notify(key, data) {
  (subs.get(key) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(`listener for "${key}" failed`, e); } });
}

let libraryPromise = null;
export function loadLibrary(force = false) {
  if (!force && libraryPromise) return libraryPromise;
  libraryPromise = call('library.list').then((res) => {
    applyLibrary(res);
    return state.scenarios;
  }).catch((e) => { libraryPromise = null; throw e; });
  return libraryPromise;
}

export function applyLibrary(res) {
  state.scenarios = res.scenarios;
  state.byName = new Map(res.scenarios.map((s) => [s.name.toLowerCase(), s]));
  state.tags = res.tags;
  state.groups = res.groups;
  notify('library');
}

export const scenario = (name) => state.byName.get((name || '').toLowerCase());
export const tagById = (id) => state.tags.find((t) => t.id === id);
export const displayName = (s) => (s && (s.customName || s.name)) || '';

export function primaryTagColor(s) {
  if (!s || !s.tags || !s.tags.length) return null;
  const t = tagById(s.tags[0]);
  return t ? t.color : null;
}

/** Merge a fresh scenario detail/meta back into the cached list without a full reload. */
export function patchScenario(name, meta) {
  const s = scenario(name);
  if (!s) return;
  Object.assign(s, {
    customName: meta.customName ?? null, tags: meta.tags || [], favorite: !!meta.favorite, hidden: !!meta.hidden,
    thumbnail: meta.thumbnail ?? null, hasNotes: !!meta.notes, preset: meta.preset ?? null,
  });
  notify('library');
}

export async function saveConfig(patch) {
  const res = await call('app.saveConfig', patch);
  state.config = res.config;
  state.valid = res.valid;
  applyAccent();
  notify('config');
  return res;
}

export function applyAccent() {
  document.documentElement.style.setProperty('--accent', state.config.accent || '#8b5cf6');
}

export async function setTags(tags, groups) {
  const res = await call('library.saveTags', { tags, groups });
  state.tags = res.tags;
  state.groups = res.groups;
  notify('library');
}
