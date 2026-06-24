import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import { exactMyPlacementValue, exactBonusPlacementValue, defaultBudget } from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 400;

export function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const rng = makeRng(opts.seed ?? 1234567);
  const exact = remainingEmpty(state) <= EXACT_THRESHOLD;
  const budget = defaultBudget(state);

  const evalMy = (L) =>
    exact ? exactMyPlacementValue(state, L, die, budget) : mcMyPlacementValue(state, L, die, MC_ROLLOUTS, rng);
  const evalBonus = (t) =>
    exact ? exactBonusPlacementValue(state, t, die, budget) : mcBonusPlacementValue(state, t, die, MC_ROLLOUTS, rng);

  const options = [];
  if (isBonus) {
    for (const t of emptyTargets(state)) {
      options.push({ target: t, alkkagi: false, winProb: evalBonus(t) });
    }
  } else {
    for (const L of legalLines(state, 'me')) {
      options.push({
        target: { side: 'me', lineIndex: L },
        alkkagi: wouldTriggerAlkkagi(state, 'me', L, die),
        winProb: evalMy(L),
      });
    }
  }
  options.sort((a, b) => b.winProb - a.winProb);
  const best = options[0] ?? null;

  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && best) {
    const baseWinProb = best.winProb;
    const mitjangWinProb = mitjangValue(state, die, exact, budget, rng);
    mitjang = { recommend: mitjangWinProb > baseWinProb + 0.01, baseWinProb, mitjangWinProb };
  }

  return { options, best, mitjang };
}

function bestMyValue(state, value, exact, budget, rng) {
  let best = -Infinity;
  for (const L of legalLines(state, 'me')) {
    const wp = exact
      ? exactMyPlacementValue(state, L, value, budget)
      : mcMyPlacementValue(state, L, value, MC_ROLLOUTS, rng);
    if (wp > best) best = wp;
  }
  return best === -Infinity ? 0 : best;
}

function mitjangValue(state, die, exact, budget, rng) {
  const consumed = setMitjang(state, 'me', false);
  const vDie = bestMyValue(consumed, die, exact, budget, rng);
  let acc = 0;
  let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === die) continue;
    const vR2 = bestMyValue(consumed, r2, exact, budget, rng);
    acc += Math.max(vDie, vR2);
    n++;
  }
  return acc / n;
}
