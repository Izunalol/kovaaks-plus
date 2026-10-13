// Post-run results screen, with a celebration for new personal bests.
import { call } from './rpc.js';
import { h, icon, thumb, fmtScore, fmtPct, fmtDateTime, rankColor, rankImg } from './ui.js';
import { state, scenario, primaryTagColor } from './state.js';
import { lineChart } from './charts.js';
import { loadThresholds, pickBenchmark, thresholdOverlay, thresholdPicker } from './thresholds.js';
import { openScenario } from './drawer.js';
import { play, nextInQueue } from './play.js';
import { showRunDetail, runGraphs } from './runs.js';
import { evxlRankIcon } from './benchcalc.js';
import { scenarioThumb } from './thumbs.js';
import { scenarioLeaderboard } from './lb.js';

let open = null;

export function closeResults() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('keydown', open.key);
  cancelAnimationFrame(open.raf);
  open = null;
}

export function showResults(d) {
  closeResults();
  const r = d.run;
  const pb = d.isPb && !d.isFirst;
  const celebrate = pb && state.config.celebratePB !== false;
  const s = scenario(r.scenario) || { name: r.scenario, tags: [] };
  const prev = d.previousBest;
  const delta = prev != null ? r.score - prev : null;
  const pct = prev ? (r.score / prev) * 100 : null;

  const scoreEl = h('div', { class: 'res-score' }, fmtScore(prev != null && pb ? prev : 0));
  const deltaEl = h('div', { class: 'res-delta ' + (delta == null ? 'muted' : delta >= 0 ? 'up' : 'down') },
    d.isFirst ? 'First recorded run — this is your baseline' :
      pb ? `+${fmtScore(delta)} over your previous best (${fmtScore(prev)})` :
        `${delta >= 0 ? '+' : ''}${fmtScore(delta)} vs PB ${fmtScore(prev)} · ${pct.toFixed(1)}% of your best`);

  // ---- benchmark rank ----
  let rankEl = null;
  if (d.rank && d.rank.ranks && d.rank.ranks.length) {
    const rk = d.rank;
    const after = rk.ranks[rk.rankAfter] || rk.ranks[0];
    const color = rankColor(after, rk.rankAfter);
    const next = rk.rankMaxes[rk.rankAfter];
    const lower = rk.rankAfter > 0 ? rk.rankMaxes[rk.rankAfter - 1] : 0;
    const best = Math.max(r.score, prev || 0);
    const prog = next ? Math.max(0, Math.min(1, (best - lower) / (next - lower))) : 1;
    rankEl = h('div', { class: 'col', style: { alignItems: 'center', gap: '10px', marginTop: '18px' } },
      rk.rankAfter > rk.rankBefore
        ? h('div', { class: 'rankup', '--rc': color }, rankImg(evxlRankIcon(rk.benchmark, after.name), 38),
          h('div', { style: { textAlign: 'left' } }, h('div', { class: 'small muted', style: { letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700 } }, 'Rank up'), h('b', null, after.name)))
        : h('span', { class: 'rank-pill', '--rc': color }, rankImg(evxlRankIcon(rk.benchmark, after.name), 20), after.name),
      h('div', { class: 'small muted' }, `${rk.benchmark || 'Benchmark'}${rk.difficulty ? ' ' + rk.difficulty : ''} · ${rk.category || ''}`),
      next ? h('div', { style: { width: '340px' } },
        h('div', { class: 'progress' }, h('i', { style: { width: (prog * 100).toFixed(1) + '%', background: color } })),
        h('div', { class: 'ticks' }, h('span', null, fmtScore(lower)), h('span', null, `${fmtScore(next - best)} to ${(rk.ranks[rk.rankAfter + 1] || {}).name || 'next rank'}`), h('span', null, fmtScore(next)))) : h('div', { class: 'small up' }, 'Top rank reached'));
  }

  const tiles = [
    ['Accuracy', fmtPct(r.accuracy)], ['Kills', r.kills], ['Avg TTK', r.avgTtk ? r.avgTtk.toFixed(3) + 's' : '—'],
    ['Hits / Shots', `${r.hits}/${r.shots}`], ['Sensitivity', r.sens ? `${+r.sens.toFixed(2)} ${r.sensScale || ''}` : '—'],
    ['FOV', r.fov ? `${r.fov}` : '—'], ['Avg FPS', r.avgFps ? Math.round(r.avgFps) : '—'], ['Pauses', r.pauseCount || 0],
  ];

  const chartHost = h('div');
  // Kovaak's-style graphs of this run (score over time, score per minute, kills…).
  const graphCard = h('div', { class: 'card pad', style: { marginTop: '16px' } }, h('h3', null, icon('chart'), 'This run'));
  call('stats.run', { file: r.file }).then((detail) => { if ((detail.kills || []).length) runGraphs(graphCard, detail, { color: pb ? '#fbbf24' : 'var(--accent)' }); else graphCard.remove(); }).catch(() => graphCard.remove());
  const historyCard = h('div', { class: 'card pad', style: { marginTop: '16px' } }, h('h3', null, 'Recent history', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'click a point for details')), chartHost);

  const thumbEl = d.thumbnail ? thumb(r.scenario, d.thumbnail) : scenarioThumb(s);

  // Space: restart the run in KovaaK's (presses its restart key), play the next queued scenario, or just switch back.
  const afterRun = state.config.afterRun || 'restart';
  const next = nextInQueue(r.scenario);
  const shortName = (n) => { const x = scenario(n); const t = (x && x.customName) || n; return t.length > 26 ? t.slice(0, 25) + '…' : t; };
  const playNext = () => { closeResults(); play(next, null); };
  const spaceAction = () => {
    closeResults();
    if (afterRun === 'next' && next) playNext();
    else if (afterRun === 'focus') call('game.focus', { resuming: false });
    else call('game.focus', { action: 'restart' });
  };
  const spaceIsNext = afterRun === 'next' && next;
  const spaceLabel = spaceIsNext ? 'Next: ' + shortName(next) + ' ' : afterRun === 'focus' ? 'Back to KovaaK\'s ' : 'Restart run ';
  const spaceIcon = spaceIsNext ? 'play' : afterRun === 'focus' ? 'target' : 'refresh';

  // Leaderboards: where this score lands globally (estimated live from KovaaK's board) and among friends.
  const posEl = h('div', { class: 'row', style: { gap: '10px', marginBottom: '12px' } }, h('div', { class: 'spinner' }), h('span', { class: 'muted small' }, 'Checking global position…'));
  const friendsHost = h('div');
  const lbCard = h('div', { class: 'card pad', style: { marginTop: '16px' } }, h('h3', null, icon('medal'), 'Leaderboard'), posEl, friendsHost);
  call('lb.position', { name: r.scenario, score: r.score }).then((p) => {
    if (!p) { posEl.replaceChildren(h('span', { class: 'muted small' }, 'This scenario has no online leaderboard.')); return; }
    const pct = p.position / Math.max(1, p.total) * 100;
    posEl.replaceChildren(h('span', { class: 'lb-me', style: { fontSize: '15px' } }, icon('medal'), 'This run would place ', h('b', null, '#' + p.position.toLocaleString()),
      h('span', { class: 'muted' }, ` of ${p.total.toLocaleString()} · top ${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`)),
      h('span', { class: 'small muted' }, 'KovaaK\'s may take a moment to show it on the official board.'));
  }).catch(() => posEl.replaceChildren(h('span', { class: 'muted small' }, 'Couldn\'t reach the leaderboard.')));
  scenarioLeaderboard(friendsHost, { name: r.scenario, compact: true, max: 10, scope: state.config.steamId ? 'friends' : 'global',
    ...(d.rank ? { rankMaxes: d.rank.rankMaxes, ranks: d.rank.ranks } : {}) });
  const el = h('div', { class: 'results' + (pb ? ' pb' : '') },
    h('div', { class: 'results-inner' },
      h('div', { class: 'res-top' },
        h('div', { class: 'res-thumb' }, thumbEl),
        h('div', { class: 'grow' }, h('div', { class: 'res-title' }, d.displayName), h('div', { class: 'muted small' }, `${r.mode} · ${fmtDateTime(r.date)}`)),
        h('button', { class: 'btn ghost', onclick: () => { closeResults(); openScenario(r.scenario); } }, icon('library'), 'Scenario details'),
        h('button', { class: 'btn ghost icon', title: 'Close (Esc)', onclick: closeResults }, icon('x'))),
      h('div', { class: 'res-hero' },
        pb ? h('div', { class: 'pb-banner' }, icon('trophy'), 'New personal best', icon('trophy')) : null,
        scoreEl, deltaEl, rankEl),
      h('div', { class: 'res-actions' },
        h('button', { class: 'btn primary lg', onclick: spaceAction }, icon(spaceIcon), spaceLabel, h('kbd', null, 'Space')),
        next && afterRun !== 'next' ? h('button', { class: 'btn lg', onclick: playNext, title: next }, icon('arrowLeft', 'flip-x'), 'Next: ' + shortName(next), h('kbd', null, 'N')) : null,
        afterRun !== 'focus' ? h('button', { class: 'btn lg', onclick: () => { closeResults(); call('game.focus', { resuming: false }); } }, icon('target'), 'Back to KovaaK\'s') : null,
        h('button', { class: 'btn lg ghost', onclick: () => { closeResults(); location.hash = '#/library'; } }, 'Choose another')),
      h('div', { class: 'grid c4' }, tiles.map(([k, v]) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, k), h('div', { class: 'value' }, v)))),
      graphCard, historyCard, lbCard));

  document.getElementById('overlay-root').append(el);

  const hist = d.history || [];
  requestAnimationFrame(() => {
    if (hist.length > 1) {
      const best = Math.max(...hist.map((x) => x.score));
      const series = [{
        points: hist.map((x, i) => ({ x: i, y: x.score, pb: x.pb && i > 0, tip: `<b>${fmtScore(x.score)}</b> · ${fmtPct(x.accuracy)}<br><span class="muted">${fmtDateTime(x.date)}</span>`, onClick: () => showRunDetail(x.file, d.displayName) })),
        color: pb ? '#fbbf24' : 'var(--accent)', area: true, dots: true,
      }];
      const drawChart = (bench) => {
        const ov = thresholdOverlay(bench, hist.map((x) => x.score));
        chartHost.replaceChildren();
        lineChart(chartHost, series, { height: 220, hLines: [...ov.hLines, { y: best, label: 'PB ' + fmtScore(best) }], bands: ov.bands, highlight: { index: hist.length - 1, color: pb ? '#fbbf24' : '#fff' } });
      };
      drawChart(null);
      loadThresholds(r.scenario).then((list) => {
        if (!el.isConnected) return;
        const bench = pickBenchmark(list);
        const picker = thresholdPicker(list, bench, drawChart);
        if (picker) historyCard.querySelector('h3 .spacer').after(picker);
        if (bench) drawChart(bench);
      });
    } else historyCard.remove();
  });

  const key = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeResults(); }
    else if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); spaceAction(); }
    else if ((e.key === 'n' || e.key === 'N') && next) { e.preventDefault(); playNext(); }
  };
  document.addEventListener('keydown', key);
  open = { el, key, raf: 0 };

  countUp(scoreEl, prev != null && pb ? prev : 0, r.score, pb ? 1400 : 700);
  if (celebrate) {
    confetti(el);
    if (state.config.sounds !== false) chime();
  }
}

function countUp(el, from, to, ms) {
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtScore(from + (to - from) * e);
    if (k < 1 && open) open.raf = requestAnimationFrame(step);
    else el.textContent = fmtScore(to);
  };
  requestAnimationFrame(step);
}

function confetti(host) {
  const canvas = h('canvas', { class: 'confetti' });
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6';
  const colors = ['#fbbf24', '#fde68a', '#f59e0b', accent, '#22d3ee', '#ffffff', '#f472b6'];
  const parts = [];
  const burst = (x, y, n, spread, dir = -Math.PI / 2, speed = 1) => {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = (7 + Math.random() * 12) * dpr * speed;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: (6 + Math.random() * 8) * dpr, h: (3 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, sway: Math.random() * 6, c: colors[(Math.random() * colors.length) | 0], life: 1 });
    }
  };
  burst(W * 0.5, H * 0.38, 160, Math.PI * 1.7);
  // Side cannons, then a gentle rain from the top so the celebration lingers.
  setTimeout(() => { burst(0, H * 0.75, 80, 0.5, -Math.PI / 3, 1.3); burst(W, H * 0.75, 80, 0.5, -Math.PI * 2 / 3, 1.3); }, 220);
  for (let k = 0; k < 6; k++) setTimeout(() => { for (let i = 0; i < 18; i++) parts.push({ x: Math.random() * W, y: -20 * dpr, vx: (Math.random() - 0.5) * 2 * dpr, vy: (1 + Math.random() * 2) * dpr, w: (6 + Math.random() * 8) * dpr, h: (3 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.2, sway: Math.random() * 6, c: colors[(Math.random() * colors.length) | 0], life: 1 }); }, 500 + k * 350);
  const t0 = performance.now();
  const tick = (t) => {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.16 * dpr; p.vx *= 0.975; p.vy *= 0.975;
      p.x += p.vx + Math.sin((t / 260) + p.sway) * 0.6 * dpr; p.y += p.vy; p.r += p.vr;
      if (t - t0 > 3800) p.life -= 0.01;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); ctx.restore();
    }
    if (t - t0 < 6500 && canvas.isConnected) requestAnimationFrame(tick); else canvas.remove();
  };
  requestAnimationFrame(tick);
}

function chime() {
  try {
    const ac = new AudioContext();
    const master = ac.createGain();
    master.gain.value = 0.18;
    master.connect(ac.destination);
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = i === 4 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const t = ac.currentTime + i * 0.085;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + (i === 4 ? 1.4 : 0.5));
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 1.5);
    });
    setTimeout(() => ac.close(), 2500);
  } catch { /* audio unavailable */ }
}
