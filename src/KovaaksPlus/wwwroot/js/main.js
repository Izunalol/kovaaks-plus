import { call, on } from './rpc.js';
import { h, icon, toast } from './ui.js';
import { state, loadLibrary, notify, scenario, displayName, subscribe } from './state.js';
import { applyAppearance } from './theme.js';
import { showResults } from './results.js';
import { showSetup } from './setup.js';
import * as home from './views/home.js';
import * as library from './views/library.js';
import * as benchmarks from './views/benchmarks.js';
import * as stats from './views/stats.js';
import * as presets from './views/presets.js';
import * as packs from './views/packs.js';
import { importFromFile } from './views/packs.js';
import { clearViewedPlayer } from './viewing.js';
import * as settings from './views/settings.js';

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', view: home },
  { id: 'library', label: 'Scenarios', icon: 'library', view: library },
  { id: 'benchmarks', label: 'Benchmarks', icon: 'trophy', view: benchmarks },
  { id: 'stats', label: 'Statistics', icon: 'chart', view: stats },
  { sep: true },
  { id: 'presets', label: 'Settings & Presets', icon: 'sliders', view: presets },
  { id: 'packs', label: 'Import / Export', icon: 'box', view: packs },
  { id: 'settings', label: 'App Settings', icon: 'settings', view: settings },
];

let cleanup = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [id, ...rest] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { id: id || 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : null, params };
}

export function go(path) { location.hash = '#/' + path; }

function renderNav() {
  const nav = document.getElementById('nav');
  const { id } = parseHash();
  nav.replaceChildren(...ROUTES.map((r) => r.sep ? h('div', { class: 'nav-sep' }) :
    h('div', { class: 'nav-item' + (r.id === id ? ' active' : ''), onclick: () => go(r.id) }, icon(r.icon), r.label)));
}

let routeToken = 0;
async function route() {
  renderNav();
  const { id, arg, params } = parseHash();
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  if (r.id !== 'benchmarks') clearViewedPlayer();   // another player's benchmarks are only shown until you leave the tab
  if (cleanup) { try { cleanup(); } catch { } cleanup = null; }
  const token = ++routeToken;
  const view = document.getElementById('view');
  view.replaceChildren();
  view.scrollTop = 0;
  const page = h('div', { class: 'page' });
  view.append(page);
  try {
    const c = (await r.view.render(page, arg, params)) || null;
    // If the user navigated elsewhere while this page was loading, release it straight away.
    if (token !== routeToken) { try { c && c(); } catch { } return; }
    cleanup = c;
  } catch (e) {
    console.error(e);
    page.append(h('div', { class: 'empty' }, icon('x'), h('b', null, 'Something went wrong'), e.message));
  }
}

// ---------------- game card & pause banner ----------------
function renderGameCard() {
  const card = document.getElementById('game-card');
  const g = state.game;
  const cur = g.currentScenario ? scenario(g.currentScenario) : null;
  card.replaceChildren(
    h('div', { class: 'game-status' }, h('span', { class: 'dot' + (g.running ? ' on' : '') }), g.running ? (state.paused ? 'KovaaK\'s · paused' : 'KovaaK\'s running') : 'KovaaK\'s not running'),
    h('div', { class: 'game-card-title', title: g.currentScenario || '' }, g.currentScenario ? displayName(cur) || g.currentScenario : (g.running ? 'In menus' : 'Ready when you are')),
    g.running
      ? h('button', { class: 'btn primary block', onclick: resumeGame }, icon('target'), 'Back to game')
      : h('button', { class: 'btn block', onclick: () => call('game.launch').then(() => toast('Launching KovaaK\'s…')) }, icon('play'), 'Launch KovaaK\'s'),
  );
}

/** From the pause bar / sidebar. While paused this restarts the run (pressing KovaaK's restart key) unless set to continue. */
export async function resumeGame() {
  const wasPaused = state.paused;
  setPaused(false);
  const restart = wasPaused && (state.config.pauseResume || 'restart') === 'restart';
  await call('game.focus', { resuming: !restart, action: restart ? 'restart' : 'focus' });
}

function setPaused(p) {
  state.paused = p;
  const b = document.getElementById('pause-banner');
  b.hidden = !p;
  if (p) {
    // Make sure Space reaches the resume shortcut instead of typing into a focused search box.
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) document.activeElement.blur();
    const cur = state.game.currentScenario;
    b.replaceChildren(
      h('span', { class: 'pulse' }),
      h('div', { class: 'grow' }, h('b', null, 'KovaaK\'s is paused'), cur ? h('span', { class: 'muted' }, ' · ' + (displayName(scenario(cur)) || cur)) : null,
        h('span', { class: 'muted small', style: { marginLeft: '10px' } }, 'Pick another scenario, tweak settings, or jump back in.')),
      h('button', { class: 'btn primary', onclick: resumeGame }, icon(state.config.pauseResume === 'continue' ? 'play' : 'refresh'),
        state.config.pauseResume === 'continue' ? 'Resume ' : 'Restart run ', h('kbd', null, 'Space')),
      h('button', { class: 'btn ghost icon', title: 'Dismiss', onclick: () => setPaused(false) }, icon('x')),
    );
  }
  renderGameCard();
}

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing) return;
  if (state.paused && (e.code === 'Space') && !document.querySelector('.results, .modal-backdrop, .drawer')) {
    e.preventDefault();
    resumeGame();
  }
});

// Dropping a .kpack anywhere imports it (and stops WebView2 from navigating to dropped files).
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) importFromFile(f);
});

// ---------------- events from the host ----------------
on('game.status', (d) => {
  state.game = { ...state.game, ...d };
  if (!d.running) setPaused(false);
  renderGameCard();
});
on('game.scenario', (d) => { state.game.currentScenario = d.name; renderGameCard(); });
on('game.pause', (d) => { if (d && d.scenario) state.game.currentScenario = d.scenario; setPaused(true); });
on('run.completed', (d) => {
  setPaused(false);
  state.game.currentScenario = d.run.scenario;
  renderGameCard();
  // Update cached library stats so cards/PBs reflect the new run immediately.
  const s = scenario(d.run.scenario);
  if (s) {
    s.plays = (s.plays || 0) + 1;
    s.lastPlayed = d.run.date;
    if (s.pb == null || d.run.score > s.pb) { s.pb = d.run.score; s.pbDate = d.run.date; }
    notify('library');
  } else loadLibrary(true);
  notify('run', d);
  showResults(d);
});
on('stats.progress', (d) => { state.statsProgress = d; notify('statsProgress', d); });
on('stats.ready', () => { state.statsReady = true; state.statsProgress = null; loadLibrary(true).catch(() => { }); notify('statsReady'); });
on('evxl.catalogProgress', (d) => notify('catalog', d));
on('toast', (d) => toast(d.text, d.kind || ''));

// ---------------- boot ----------------
async function boot() {
  const init = await call('app.init');
  Object.assign(state, { config: init.config, version: init.version, valid: init.valid, statsReady: init.statsReady, dataFolder: init.dataFolder });
  state.game = { running: init.running, currentScenario: init.currentScenario };
  applyAppearance();
  subscribe('config', applyAppearance);
  renderGameCard();
  window.addEventListener('hashchange', route);
  if (init.firstRun || !init.valid) {
    showSetup(() => { loadLibrary(true).catch(() => { }); route(); });
  } else {
    loadLibrary().catch(() => { });
  }
  route();
}

boot().catch((e) => {
  document.getElementById('view').append(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, 'Could not start'), e.message)));
});
