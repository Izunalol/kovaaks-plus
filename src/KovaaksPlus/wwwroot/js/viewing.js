// Viewing another player's benchmarks. Kept in memory only: it ends when you leave the Benchmarks tab
// (main.js clears it on route change) or relaunch the app.
import { call } from './rpc.js';
import { h, icon, flag, modal, contextMenu, toast, debounce } from './ui.js';
import { state, saveConfig } from './state.js';
import { closeDrawer } from './drawer.js';
import { closeResults } from './results.js';

let viewing = null;   // { steamId, name, country }

export const viewedPlayer = () => viewing;
export const viewedSteamId = () => (viewing ? viewing.steamId : null);
export function clearViewedPlayer() { viewing = null; }

/** The benchmark page you're on, so switching players keeps you there. */
function currentBenchId() {
  const m = location.hash.match(/^#\/benchmarks\/(\d+)/);
  return m ? +m[1] : null;
}

/**
 * Opens a player's benchmarks (yourself, or null, means back to yours).
 * benchId: benchmark to show; defaults to the benchmark page you're on, else the catalog.
 */
export function viewPlayer(p, benchId) {
  viewing = p && p.steamId && p.steamId !== state.config.steamId
    ? { steamId: String(p.steamId), name: p.name || p.steamId, country: p.country || null } : null;
  document.getElementById('modal-root')?.replaceChildren();
  closeDrawer();
  closeResults();
  const id = benchId === undefined ? currentBenchId() : benchId;
  const target = '#/benchmarks' + (id ? '/' + id : '');
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export const evxlProfileUrl = (steamId) => `https://evxl.app/u/${steamId}`;


// ---------------------------------------------------------------- favourite players (saved in config.ui.favoritePlayers)
export const favoritePlayers = () => (state.config.ui && state.config.ui.favoritePlayers) || [];
export const isFavorite = (steamId) => favoritePlayers().some((p) => p.steamId === steamId);

export async function toggleFavorite(p) {
  const ui = JSON.parse(JSON.stringify(state.config.ui || {}));
  const list = ui.favoritePlayers || [];
  const i = list.findIndex((x) => x.steamId === p.steamId);
  if (i >= 0) list.splice(i, 1);
  else list.push({ steamId: String(p.steamId), name: p.name || String(p.steamId), country: p.country || null });
  ui.favoritePlayers = list;
  try { await saveConfig({ ui }); toast(i >= 0 ? `Removed ${p.name} from favorites` : `Added ${p.name} to favorites`, 'ok'); }
  catch (e) { toast(e.message, 'error'); }
  return i < 0;
}

/** Star toggle; onChange(isNowFavorite) lets the caller redraw. */
export function favButton(p, onChange, cls = 'btn ghost icon sm') {
  const on = isFavorite(p.steamId);
  return h('button', {
    class: cls + ' fav-btn' + (on ? ' on' : ''), title: on ? 'Remove from favorites' : 'Add to favorites',
    onclick: async (e) => { e.stopPropagation(); const now = await toggleFavorite(p); onChange && onChange(now); },
  }, icon('star', on ? 'fav-star' : ''));
}

/** Click and right-click behaviour for a leaderboard row. */
export function playerRowProps(p, benchId) {
  if (!p || !p.steamId) return {};
  const self = p.steamId === state.config.steamId;
  return {
    title: self ? 'View your benchmarks' : `View ${p.name || 'their'}'s benchmarks`,
    onclick: () => viewPlayer(p, benchId),
    oncontextmenu: (e) => contextMenu(e, [
      { header: p.name || p.steamId },
      { label: self ? 'View my benchmarks' : 'View their benchmarks', icon: 'trophy', onClick: () => viewPlayer(p, benchId) },
      self ? null : { label: isFavorite(p.steamId) ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => toggleFavorite(p) },
      { sep: true },
      { label: 'Open profile on evxl.app', icon: 'external', onClick: () => call('app.openUrl', { url: evxlProfileUrl(p.steamId) }) },
      { label: 'Open Steam profile', icon: 'external', onClick: () => call('app.openUrl', { url: `https://steamcommunity.com/profiles/${p.steamId}` }) },
    ]),
  };
}

/** Banner at the top of the Benchmarks pages while someone else is shown. */
export function viewingBanner(extraUrl) {
  if (!viewing) return null;
  const v = viewing;
  const bar = h('div', { class: 'card viewing-bar' });
  const draw = () => bar.replaceChildren(
    icon('user'),
    h('div', { class: 'grow' },
      h('div', { class: 'viewing-title' }, 'Viewing', v.country ? flag(v.country) : null, h('span', null, h('b', null, v.name), '’s benchmarks'), favButton(v, draw)),
      h('div', { class: 'small muted' }, 'Their KovaaK\'s leaderboard scores. Goes back to yours when you leave Benchmarks.')),
    h('button', { class: 'btn ghost sm', onclick: () => call('app.openUrl', { url: extraUrl || evxlProfileUrl(v.steamId) }) }, icon('external'), 'evxl.app'),
    h('button', { class: 'btn sm', onclick: () => findPlayer() }, icon('search'), 'Another player'),
    h('button', { class: 'btn primary sm', onclick: () => viewPlayer(null) }, icon('arrowLeft'), 'Back to mine'));
  draw();
  return bar;
}

/** Quick row of favourite players for the Benchmarks page (null when there are none). */
export function favoritesStrip() {
  const favs = favoritePlayers();
  if (!favs.length) return null;
  return h('div', { class: 'fav-strip' },
    h('span', { class: 'small muted' }, icon('star', 'fav-star'), 'Favorites'),
    favs.map((p) => h('button', { class: 'chip btnlike' + (viewing && viewing.steamId === p.steamId ? ' on' : ''), title: `View ${p.name}'s benchmarks`, onclick: () => viewPlayer(p) },
      p.country ? flag(p.country) : null, p.name)),
    h('button', { class: 'btn ghost sm', onclick: () => findPlayer() }, icon('user'), 'Friends & search'));
}

let friendsCache = null;   // this app session

/**
 * Player picker: favourites and Steam friends (filtered as you type), plus evxl search on Enter.
 * Search accepts a Steam name, KovaaK's username, SteamID64, or a Steam / evxl.app profile link.
 */
export function findPlayer() {
  const input = h('input', { class: 'input', placeholder: 'Filter, or search a Steam name, SteamID64 or profile link', style: { width: '100%' } });
  const body = h('div', { class: 'player-results' });
  const go = h('button', { class: 'btn primary' }, icon('search'), 'Search');
  let friends = friendsCache;
  let friendsError = null;
  let searchHits = null;   // null = not searched; [] = nothing found
  let searching = false;
  let token = 0;

  const note = (text) => h('div', { class: 'muted small', style: { padding: '6px 10px 10px' } }, text);
  const hit = (p, extra) => h('div', { class: 'player-hit', onclick: () => open(p) },
    p.country ? flag(p.country) : null, h('b', null, p.name),
    p.steamAccountName && p.steamAccountName !== p.name ? h('span', { class: 'muted small' }, 'Steam: ' + p.steamAccountName) : null,
    extra || null,
    h('span', { class: 'grow' }),
    p.steamId === state.config.steamId ? h('span', { class: 'badge accent' }, 'You') : favButton(p, draw));

  function draw() {
    const q = input.value.trim().toLowerCase();
    const match = (p) => !q || (p.name || '').toLowerCase().includes(q) || (p.steamAccountName || '').toLowerCase().includes(q) || p.steamId === q;
    const favs = favoritePlayers().filter(match);
    const favIds = new Set(favoritePlayers().map((p) => p.steamId));
    const fr = (friends || []).filter((p) => !favIds.has(p.steamId)).filter(match).sort((a, b) => a.name.localeCompare(b.name));
    const section = (title, count) => h('div', { class: 'ph-section' }, title, count != null ? h('span', { class: 'muted' }, ' · ' + count) : null);
    body.replaceChildren(...[
      searching ? h('div', { class: 'row muted small', style: { padding: '10px' } }, h('div', { class: 'spinner' }), 'Searching evxl.app…') : null,
      searchHits ? section('Search results', searchHits.length) : null,
      searchHits ? (searchHits.length ? searchHits.map((p) => hit(p)) : note('No players found. Try their Steam profile link or SteamID64.')) : null,
      section('Favorites', favs.length),
      favs.length ? favs.map((p) => hit(p)) : note(q ? 'No favorites match.' : 'Star a player to keep them here.'),
      section('Friends', friends ? fr.length : null),
      !state.config.steamId ? note('Add your Steam ID in App Settings to see your Steam friends.')
        : friendsError ? note(friendsError)
        : !friends ? h('div', { class: 'row muted small', style: { padding: '6px 10px' } }, h('div', { class: 'spinner' }), 'Loading your Steam friends…')
        : fr.length ? fr.map((p) => hit(p)) : note(q ? 'No friends match.' : 'None of your Steam friends are on evxl.app yet.'),
    ].flat());
  }

  const search = async () => {
    const q = input.value.trim();
    if (!q) return;
    const t = ++token;
    searching = true; draw();
    let list;
    try { list = await call('player.search', { query: q }); }
    catch (e) { if (t === token) { searching = false; searchHits = []; draw(); toast(e.message, 'error'); } return; }
    if (t !== token) return;
    searching = false;
    if (list.length === 1 && /^\d{17}$|steamcommunity|evxl\.app/i.test(q)) { open(list[0]); return; }
    searchHits = list;
    draw();
  };
  input.addEventListener('input', debounce(() => { searchHits = null; draw(); }, 80));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  go.addEventListener('click', search);
  const open = (p) => { dlg.close(); viewPlayer(p); };
  const dlg = modal({
    title: 'View a player’s benchmarks',
    body: h('div', { class: 'col', style: { gap: '10px' } },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, input), go),
      h('div', { class: 'small muted' }, 'Typing filters your favorites and friends. Press Enter to search everyone on evxl.app (names, SteamID64, Steam or evxl.app links).'),
      body),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
  draw();
  if (state.config.steamId && !friends) {
    call('lb.friends', {}).then((list) => { friends = friendsCache = list || []; draw(); })
      .catch((e) => { friendsError = 'Couldn\'t load friends: ' + e.message; draw(); });
  }
}