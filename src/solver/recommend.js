import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import { exactMyPlacementValue, exactBonusPlacementValue, defaultBudget } from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 400;

export function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const baseSeed = opts.seed ?? 1234567;
  const exact = remainingEmpty(state) <= EXACT_THRESHOLD;
  const budget = defaultBudget(state);

  // 후보마다 독립적인 시드를 줘서, 각 옵션의 MC 표본이 앞 옵션들의 후보 수에 영향받지 않게 한다.
  const evalMy = (L) =>
    exact ? exactMyPlacementValue(state, L, die, budget)
          : mcMyPlacementValue(state, L, die, MC_ROLLOUTS, makeRng(baseSeed + 1 + L));
  const evalBonus = (t) =>
    exact ? exactBonusPlacementValue(state, t, die, budget)
          : mcBonusPlacementValue(state, t, die, MC_ROLLOUTS, makeRng(baseSeed + 20 + (t.side === 'opp' ? 3 : 0) + t.lineIndex));

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
    const mitjangWinProb = mitjangValue(state, die, exact, budget, baseSeed);
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

function mitjangValue(state, die, exact, budget, baseSeed) {
  const consumed = setMitjang(state, 'me', false);
  const vDie = bestMyValue(consumed, die, exact, budget, makeRng(baseSeed + 100 + die));
  let acc = 0;
  let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === die) continue;
    const vR2 = bestMyValue(consumed, r2, exact, budget, makeRng(baseSeed + 100 + r2));
    acc += Math.max(vDie, vR2);
    n++;
  }
  return acc / n;
}
