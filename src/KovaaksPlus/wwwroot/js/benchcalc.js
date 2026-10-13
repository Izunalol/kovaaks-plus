// Benchmark scoring, ported from evxl.app so ranks match the site. Supported locally: basic, vt-energy, generic-energy,
// generic-energy-uncapped and complete. For evxl's other (custom) methods the UI falls back to evxl's server rank.

export const CALC_INFO = {
  'basic': 'Your rank is the lowest rank among subcategories, where each subcategory counts its best scenario.',
  'vt-energy': 'Each subcategory contributes "energy" from its best non-strafe scenario. Energies are combined with a harmonic mean (capped one rank above max) and the overall rank is the threshold your energy reaches.',
  'generic-energy': 'Each subcategory contributes energy from its best scenario (100 per rank). Energies are combined with a harmonic mean, capped one rank above max.',
  'generic-energy-uncapped': 'Like generic energy, but energy keeps rising beyond the highest rank threshold.',
  'complete': 'Your rank is the lowest rank achieved across every scenario in the benchmark.',
};
export const SUPPORTED = new Set(Object.keys(CALC_INFO));

// ---- primitives (names follow evxl's minified functions for traceability) ----

/** U: rank position of a score within thresholds. */
export function rankOf(score, maxes) {
  if (!score || score <= 0 || !maxes || !maxes.length) return { baseRank: 0, preciseRank: 0, progressToNext: 0, isMaxed: false };
  let r = 0;
  for (let a = maxes.length - 1; a >= 0; a--) if (score >= maxes[a]) { r = a + 1; break; }
  if (r === 0) {
    const a = Math.min(...maxes.filter((x) => x > 0));
    return { baseRank: 0, preciseRank: 0, progressToNext: isFinite(a) && a > 0 ? Math.min(score / a, 0.99) : 0, isMaxed: false };
  }
  if (r === maxes.length) {
    const a = maxes[maxes.length - 1], i = maxes.length > 1 ? maxes[maxes.length - 2] : 0, l = Math.abs(a - i) || 1;
    const u = Math.max(0, (score - a) / l);
    return { baseRank: r, preciseRank: r + u, progressToNext: u - Math.floor(u), isMaxed: true };
  }
  const t = maxes[r - 1], s = maxes[r] - t, c = s > 0 ? (score - t) / s : 0;
  return { baseRank: r, preciseRank: r + c, progressToNext: Math.max(0, Math.min(c, 1)), isMaxed: false };
}

/** ne: energy of a subcategory's best scenario. */
function energy(sub, n, fakeLower, fakeUpper) {
  const trunc = Math.trunc;
  if (sub.baseRank === 0 && sub.preciseRank === 0) {
    const d = sub.score, k = sub.rankMaxes || [];
    if (!d || k.length < 2) return 0;
    const m = k[0], f = k[1] - m, b = m - f, p = n[0] - fakeLower, N = n[0];
    return trunc(d < b ? (d / b) * p : p + ((d - b) / (m - b)) * (N - p));
  }
  const a = n.length, i = n[0] - fakeLower, l = n[a - 1], u = n[a - 2], g = l - u || 100, hh = l + g;
  const pr = sub.preciseRank;
  if (pr <= 0) return 0;
  if (pr < 1) return trunc(i + pr * (n[0] - i));
  if (pr < a) { const d = Math.floor(pr), k = pr - d, m = d === 0 ? i : n[d - 1], R = n[d]; return trunc(m + k * (R - m)); }
  if (pr < a + fakeUpper) { const d = pr - a; return trunc(l + d * (hh - l)); }
  return trunc(hh);
}

const harmonic = (vals, n) => (vals.length !== n || vals.some((x) => x === 0) ? 0 : vals.length / vals.reduce((a, x) => a + 1 / x, 0));

/** K: progress towards the next overall rank. */
function progressTo(value, thresholds, rank) {
  const t = (a) => Math.floor(a * 100) / 100;
  if (!thresholds || !thresholds.length) return 0;
  if (rank <= 0) { const a = Math.min(...thresholds.filter((x) => x > 0)); return !isFinite(a) || a <= 0 ? 0 : t(Math.max(0, Math.min(value / a, 1))); }
  if (rank >= thresholds.length) return 1;
  const o = thresholds[rank - 1] ?? 0, c = thresholds[rank] - o;
  return !isFinite(c) || c <= 0 ? 0 : t(Math.max(0, Math.min((value - o) / c, 1)));
}

function subcategoryKeys(subs) {
  const seen = {};
  return subs.map((s, k) => {
    let key = (s.subcategoryName || '').trim() || `#${k + 1}`;
    if (seen[key]) key += ` (${++seen[key]})`; else seen[key] = 1;
    return key;
  });
}

/** be: best scenario per subcategory, walking scenarios in layout order. */
function bestPerSubcategory(list, layout, useEnergy, thresholds, fakeLower, fakeUpper) {
  const out = {};
  let i = 0;
  for (const cat of layout) {
    out[cat.categoryName] = {};
    const keys = subcategoryKeys(cat.subcategories);
    cat.subcategories.forEach((sub, k) => {
      let R = -1;
      let best = { baseRank: 0, preciseRank: 0, progressToNext: 0, isMaxed: false, scenarioName: '', score: 0, rankMaxes: [] };
      for (let b = 0; b < sub.scenarioCount && i < list.length; b++, i++) {
        const p = list[i];
        if (!p || !p.score) continue;
        const E = { ...rankOf(p.score, p.rankMaxes), scenarioName: p.name, score: p.score, rankMaxes: p.rankMaxes || [] };
        let take = false;
        if (R === -1) take = true;
        else if (E.baseRank > 0 && best.baseRank === 0) take = true;
        else if (E.baseRank > 0 && best.baseRank > 0) take = E.preciseRank > best.preciseRank;
        else if (E.baseRank === 0 && best.baseRank === 0) {
          if (useEnergy && thresholds) take = energy(E, thresholds, fakeLower, fakeUpper) > energy(best, thresholds, fakeLower, fakeUpper);
          else {
            const O = E.rankMaxes.length ? E.score / E.rankMaxes[0] : 0, C = best.rankMaxes.length ? best.score / best.rankMaxes[0] : 0;
            take = O > C;
          }
        }
        if (take) { R = E.preciseRank; best = E; }
      }
      out[cat.categoryName][keys[k]] = best;
    });
  }
  return out;
}

/** te: harmonic-mean energy rank. */
function energyRank(list, layout, diffName, thresholds, filter, fakeLower, fakeUpper, cap, uncapped = false) {
  const subs = bestPerSubcategory(list, layout, true, thresholds, fakeLower, fakeUpper);
  const isAdv = (diffName || '').toLowerCase() === 'advanced';
  const d = typeof cap === 'number' ? cap : isAdv && !uncapped ? 1200 : undefined;
  const energies = [], subEnergies = {};
  for (const [cat, entries] of Object.entries(subs)) {
    subEnergies[cat] = {};
    for (const [sub, best] of Object.entries(entries)) {
      if (!filter(sub)) continue;
      let S = energy(best, thresholds, fakeLower, fakeUpper);
      if (typeof d === 'number' && S > d) S = d;
      subEnergies[cat][sub] = S;
      energies.push(S);
    }
  }
  const k = layout.reduce((a, c) => a + subcategoryKeys(c.subcategories).filter(filter).length, 0);
  const m = energies.length === k ? Math.round(harmonic(energies.filter((x) => x > 0), k) * 10) / 10 : 0;
  let rank = 0;
  for (let i = thresholds.length - 1; i >= 0; i--) if (m >= thresholds[i]) { rank = i + 1; break; }
  let progress = progressTo(m, thresholds, rank);
  if (uncapped && rank >= thresholds.length && thresholds.length) {
    const f = thresholds[thresholds.length - 1], b = thresholds.length > 1 ? thresholds[thresholds.length - 2] : f - 100, p = f - b || 100;
    progress = 1 + Math.max(0, (m - f) / p);
  }
  return { rank, energy: m, subEnergies, thresholds, progress, subs, params: { thresholds, fakeLower, fakeUpper, cap: d, filter } };
}

/** Ae: Voltaic's fixed energy thresholds per difficulty. */
function vtThresholds(diffName, rankNames, ranks) {
  const t = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500];
  const o = (diffName || '').toLowerCase();
  if (o === 'elite (unofficial)') {
    const norm = (g) => g.toLowerCase().replace(/[^a-z]/g, '');
    const bad = (g) => ['unranked', 'norank', 'nodata', 'notcomplete'].includes(norm(g));
    const first = (rankNames || []).map((r) => r.name).find((n) => n && !bad(n)) || (ranks || []).map((r) => r.name).find((n) => n && !bad(n));
    return first && norm(first).startsWith('grandmaster') ? t.slice(8, 14) : t.slice(9, 15);
  }
  const map = { novice: [0, 4], intermediate: [4, 8], advanced: [8, 12] };
  const [a, b] = map[o] || [0, t.length];
  return t.slice(a, b);
}

/** Rank badge image from evxl.app (the same artwork evxl shows). The <img> hides itself if evxl has none. */
export const evxlRankIcon = (benchmark, rank) =>
  benchmark && rank && !/^(no rank|unranked)$/i.test(rank) ? `https://evxl.app/rank-icons/kovaaks/${encodeURIComponent(benchmark)}/${encodeURIComponent(rank)}.png` : null;

/** Scenario list in benchmark order with the best known score (custom what-if value, else local PB or leaderboard score). */
export function scenarioList(b) {
  return b.categories.flatMap((c) => c.scenarios.map((s) => {
    const score = s.customScore != null ? s.customScore : Math.max(s.localBest || 0, s.remoteScore || 0);
    return { ...s, score, rankMaxes: s.rankMaxes || [], scenarioRank: rankOf(score, s.rankMaxes || []).baseRank };
  }));
}

/** evxl layout (categories → subcategories with scenario counts); synthesised from KovaaK's categories if missing. */
export function layoutOf(b) {
  const total = b.categories.reduce((a, c) => a + c.scenarios.length, 0);
  const layout = b.layout && b.layout.length ? b.layout : null;
  const count = layout ? layout.reduce((a, c) => a + c.subcategories.reduce((x, s) => x + (s.scenarioCount || 0), 0), 0) : 0;
  if (layout && count === total) return layout;
  return b.categories.map((c) => ({ categoryName: c.name.replace(/(?<=[a-z])(?=[A-Z])/g, ' '), color: null, subcategories: [{ subcategoryName: '', scenarioCount: c.scenarios.length, color: null }] }));
}

export function rankName(rank, b) {
  if (rank <= 0) return 'Unranked';
  const n = (b.rankNames || [])[rank - 1];
  if (n) return n.name;
  return (b.ranks || [])[rank]?.name || `Rank ${rank}`;
}

export function rankEntry(rank, b) {
  if (rank <= 0) return { name: 'Unranked', color: '#6b7280', icon: null };
  const n = (b.rankNames || [])[rank - 1];
  const k = (b.ranks || [])[rank];
  const name = n?.name || k?.name || `Rank ${rank}`;
  return { name, color: n?.color || k?.color, icon: evxlRankIcon(b.name, name) };
}

/**
 * Computes the overall benchmark result. Returns
 * { supported, method, rank, name, complete, energy, subEnergies, thresholds, progress, completeRank }
 */
export function computeBenchmark(b) {
  const list = scenarioList(b);
  const layout = layoutOf(b);
  const method = b.rankCalculation || 'basic';
  const diff = b.difficulty || '';
  const rankCount = (b.rankNames || []).length || Math.max(0, (b.ranks || []).length - 1);

  // pe: "Complete" rank = lowest scenario rank across every scenario (all must be scored and ranked).
  let completeRank = Infinity;
  for (const s of list) { if (!s.score || s.scenarioRank <= 0) { completeRank = 0; break; } completeRank = Math.min(completeRank, s.scenarioRank); }
  if (!isFinite(completeRank)) completeRank = 0;

  let res = null;
  try {
    if (method === 'vt-energy') {
      const th = vtThresholds(diff, b.rankNames, b.ranks);
      const fakeLower = diff.toLowerCase() === 'novice' ? 0 : 100;
      const noStrafe = (name) => !name.toLowerCase().includes('strafe');
      res = energyRank(list, layout, diff, th, noStrafe, fakeLower, 1);
      if (diff.toLowerCase() === 'advanced' && rankCount > 0 && res.rank >= rankCount)
        res = energyRank(list, layout, diff, th, noStrafe, fakeLower, Number.POSITIVE_INFINITY, undefined, true);
    } else if (method === 'generic-energy' || method === 'generic-energy-uncapped') {
      // Thresholds continue across difficulties: 100 per rank, offset by the ranks of easier difficulties.
      const diffs = b.difficulties && b.difficulties.length ? b.difficulties : [{ name: diff, rankCount }];
      const total = diffs.reduce((a, d) => a + (d.rankCount || 0), 0);
      const all = Array.from({ length: total + 1 }, (_, i) => (i + 1) * 100);
      let offset = 0;
      for (const d of diffs) { if (d.name === diff) break; offset += d.rankCount || 0; }
      const slice = all.slice(offset, offset + rankCount + 1);
      const th = slice.slice(0, -1), cap = slice[slice.length - 1];
      res = method === 'generic-energy'
        ? energyRank(list, layout, diff, th, () => true, 100, 1, cap)
        : energyRank(list, layout, diff, th, () => true, 100, 9999, undefined);
    } else if (method === 'basic') {
      const subs = bestPerSubcategory(list, layout, false);
      const ranks = [];
      let unranked = false;
      Object.values(subs).forEach((c) => Object.values(c).forEach((s) => (s.baseRank > 0 ? ranks.push(s.baseRank) : (unranked = true))));
      const rank = unranked ? 0 : ranks.length ? Math.min(...ranks) : 0;
      let sum = 0, count = 0;
      Object.values(subs).forEach((c) => Object.values(c).forEach((s) => {
        count++;
        sum += s.baseRank === 0 || s.preciseRank === 0 ? 0.001 : s.preciseRank < rank ? 0 : s.preciseRank >= rank + 1 ? 1 : s.preciseRank - rank;
      }));
      res = { rank, progress: rank >= rankCount ? 1 : count ? sum / count : 0, subs };
    } else if (method === 'complete') {
      res = { rank: completeRank, progress: completeRank > 0 ? 1 : 0 };
    }
  } catch (e) { console.warn('benchmark calc failed', e); res = null; }

  if (!res) return { supported: false, method, completeRank, layout, list, rankCount };
  const name = rankName(res.rank, b);
  const complete = res.rank > 0 && completeRank >= res.rank;
  return { supported: true, method, ...res, name, complete, display: complete ? `${name} Complete` : name, completeRank, layout, list, rankCount };
}

// =====================================================================================================
// Planner: what to improve to reach a target rank / energy.

/** Energy one scenario score is worth under a method's parameters. */
export function scenarioEnergy(score, rankMaxes, p) {
  const e = energy({ ...rankOf(score, rankMaxes), score, rankMaxes }, p.thresholds, p.fakeLower, p.fakeUpper);
  return typeof p.cap === 'number' && e > p.cap ? p.cap : e;
}

/** Smallest score whose energy reaches `target` (energy is monotonic in score, so binary search). */
function scoreForEnergy(rankMaxes, target, p) {
  if (!rankMaxes || !rankMaxes.length) return null;
  let lo = 0, hi = Math.max(...rankMaxes) * 6;
  if (scenarioEnergy(hi, rankMaxes, p) < target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (scenarioEnergy(mid, rankMaxes, p) >= target) hi = mid; else lo = mid;
  }
  return Math.ceil(hi * 100) / 100;
}

/** Scenarios grouped by subcategory in layout order. */
function groupsOf(res) {
  const out = [];
  let i = 0;
  for (const cat of res.layout) {
    const keys = subcategoryKeys(cat.subcategories);
    cat.subcategories.forEach((sub, k) => {
      const items = [];
      for (let n = 0; n < sub.scenarioCount && i < res.list.length; n++, i++) items.push(res.list[i]);
      out.push({ cat: cat.categoryName, sub: keys[k], label: sub.subcategoryName || cat.categoryName, items });
    });
  }
  return out;
}

const increase = (cur, need, maxes) => {
  if (need == null) return Infinity;
  if (cur >= need) return 0;
  const base = cur > 0 ? cur : (maxes && maxes[0]) || need;
  return (need - cur) / base;
};

function cheapest(items, neededFor) {
  let best = null;
  for (const s of items) {
    const need = neededFor(s);
    if (need == null) continue;
    const pct = increase(s.score, need, s.rankMaxes);
    if (!best || pct < best.pct) best = { scenario: s, need, pct };
  }
  return best;
}

/**
 * target: { rank } or { energy }. Returns { mode, achievable, already, items: [{ name, group, current, need, pct, note }], targetEnergy, level }.
 * Energy methods "water-fill": the weakest subcategories are raised to a common level until the harmonic mean
 * reaches the target, using whichever scenario in each needs the smallest relative improvement.
 */
export function planBenchmark(b, res, target) {
  const groups = groupsOf(res);
  const energyMethod = res.supported && res.params;
  if (energyMethod && (target.energy != null || target.rank != null)) {
    const p = res.params;
    const T = target.energy != null ? target.energy : p.thresholds[target.rank - 1];
    if (T == null) return { achievable: false, items: [], note: 'That rank has no energy threshold.' };
    const subs = groups.filter((g) => p.filter(g.sub)).map((g) => ({ ...g, e: res.subEnergies[g.cat]?.[g.sub] ?? 0 }));
    const k = subs.length;
    const hm = (vals) => Math.round(harmonic(vals.filter((x) => x > 0), k) * 10) / 10;
    if (hm(subs.map((s) => s.e)) >= T) return { already: true, achievable: true, items: [], targetEnergy: T };
    const maxE = typeof p.cap === 'number' ? p.cap : (p.thresholds[p.thresholds.length - 1] + (p.thresholds[p.thresholds.length - 1] - (p.thresholds[p.thresholds.length - 2] || 0)) * Math.min(p.fakeUpper, 50));
    if (hm(subs.map((s) => Math.max(s.e, maxE))) < T) return { achievable: false, items: [], targetEnergy: T, note: 'Not reachable: subcategory energy is capped below what this target needs.' };
    let lo = 0, hi = maxE;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (hm(subs.map((s) => Math.max(s.e, mid))) >= T) hi = mid; else lo = mid; }
    const level = Math.ceil(hi);
    const items = [];
    for (const g of subs) {
      if (g.e >= level) continue;
      const best = cheapest(g.items, (s) => scoreForEnergy(s.rankMaxes, level, p));
      if (best) items.push({ name: best.scenario.name, customName: best.scenario.customName, group: g.label, current: best.scenario.score, need: best.need, pct: best.pct, from: g.e, to: level });
    }
    return { achievable: true, items: items.sort((a, b2) => a.pct - b2.pct), targetEnergy: T, level, mode: 'energy' };
  }

  // Rank-based methods: basic needs every subcategory at the rank; complete/others need every scenario there.
  const R = target.rank;
  if (!R) return { achievable: false, items: [] };
  const perScenario = !(res.supported && res.method === 'basic');
  const items = [];
  for (const g of groups) {
    const pool = perScenario ? g.items.map((s) => [s]) : [g.items];
    for (const set of pool) {
      const reached = set.some((s) => rankOf(s.score, s.rankMaxes).baseRank >= R);
      if (reached) continue;
      const best = cheapest(set, (s) => (s.rankMaxes || [])[R - 1]);
      if (best) items.push({ name: best.scenario.name, customName: best.scenario.customName, group: g.label, current: best.scenario.score, need: best.need, pct: best.pct });
    }
  }
  return { achievable: true, already: items.length === 0, items: items.sort((a, b2) => a.pct - b2.pct), mode: perScenario ? 'scenario' : 'subcategory' };
}
