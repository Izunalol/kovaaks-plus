// First-run setup: everything is auto-detected, the user just confirms.
import { call } from './rpc.js';
import { h, icon, toggle, toast } from './ui.js';
import { state, saveConfig } from './state.js';

export function showSetup(done) {
  const cfg = { ...state.config };
  const root = h('div', { class: 'setup' });
  const card = h('div', { class: 'card setup-card' });
  root.append(card);
  document.body.append(root);

  const draw = async () => {
    const gameOk = cfg.gamePath ? (await call('app.validateGamePath', { path: cfg.gamePath })).valid : false;
    const steam = h('input', { class: 'input', value: cfg.steamId || '', placeholder: '7656119…', style: { width: '210px' } });
    steam.addEventListener('change', () => { cfg.steamId = steam.value.trim() || null; });

    card.replaceChildren(
      h('img', { src: 'assets/logo.png', style: { width: '56px', height: '56px' } }),
      h('h1', null, 'Welcome to Kovaak\'s Plus'),
      h('div', { class: 'muted', style: { fontSize: '15px', marginBottom: '22px' } },
        'Your control center for KovaaK\'s. Browse and launch scenarios here; the game only comes forward when you\'re aiming. Pause or finish a run and you\'re back here with your stats.'),

      h('div', { class: 'col' },
        h('div', { class: 'check-row' },
          h('span', { class: gameOk ? 'ok' : 'no' }, gameOk ? '✓' : '✕'),
          h('div', { class: 'grow' }, h('b', null, 'KovaaK\'s installation'), h('div', { class: 'small muted ellipsis' }, cfg.gamePath || 'Not found automatically')),
          h('button', { class: 'btn sm', onclick: async () => {
            const p = await call('app.pickFolder', { title: 'Select the FPSAimTrainer folder (…\\steamapps\\common\\FPSAimTrainer)' });
            if (p) { cfg.gamePath = p; draw(); }
          } }, icon('folder'), 'Browse')),
        h('div', { class: 'check-row' },
          h('span', { class: cfg.workshopPaths?.length ? 'ok' : 'muted' }, cfg.workshopPaths?.length ? '✓' : '–'),
          h('div', { class: 'grow' }, h('b', null, 'Steam Workshop scenarios'), h('div', { class: 'small muted' }, cfg.workshopPaths?.length ? `${cfg.workshopPaths.length} workshop folder(s) found` : 'None found (that\'s fine)'))),
        h('div', { class: 'check-row' },
          h('span', { class: cfg.steamId ? 'ok' : 'muted' }, cfg.steamId ? '✓' : '–'),
          h('div', { class: 'grow' }, h('b', null, 'Steam account'), h('div', { class: 'small muted' }, cfg.steamName ? `Signed in as ${cfg.steamName}. Used for benchmark ranks on evxl.app` : 'Used for benchmark ranks (optional)')),
          steam)),

      h('div', { style: { marginTop: '22px' } }, h('div', { class: 'small muted', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' } }, 'Behavior')),
      optRow('Pausing in KovaaK\'s brings this app forward', `Press ${cfg.pauseKey || 'Escape'} in game to come back here`, 'pauseBringsApp'),
      optRow('Show results when a run ends', 'Score, PB comparison and benchmark rank', 'runEndBringsApp'),
      optRow('Celebrate new personal bests', 'Confetti and a short chime', 'celebratePB'),

      h('div', { class: 'small muted', style: { marginTop: '16px', padding: '12px 14px', background: 'var(--bg-2)', borderRadius: '10px', border: '1px solid var(--border)' } },
        h('b', { style: { color: 'var(--text-2)' } }, 'Tip: '), 'Set KovaaK\'s display mode to ', h('b', null, 'Windowed Fullscreen'), ' so switching between the game and this app is instant.'),

      h('div', { class: 'row', style: { marginTop: '24px' } },
        h('div', { class: 'grow' }),
        h('button', { class: 'btn primary lg', disabled: !gameOk, onclick: finish }, 'Let\'s go', icon('arrowLeft', 'flip'))),
    );
    card.querySelector('.flip')?.setAttribute('style', 'transform: rotate(180deg)');
  };

  function optRow(label, hint, key) {
    if (cfg[key] === undefined) cfg[key] = true;
    return h('div', { class: 'row', style: { padding: '8px 2px' } },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, label), h('div', { class: 'small muted' }, hint)),
      toggle(cfg[key] !== false, (v) => { cfg[key] = v; }));
  }

  async function finish() {
    try {
      const res = await saveConfig({ ...cfg, setupComplete: true });
      if (!res.valid) { toast('That folder doesn\'t look like a KovaaK\'s install', 'error'); return; }
      root.remove();
      toast('All set! Indexing your stats…', 'ok');
      done && done();
    } catch (e) { toast(e.message, 'error'); }
  }

  draw();
}
