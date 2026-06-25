import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import {
  exactMyPlacementValue, exactBonusPlacementValue, defaultBudget,
  resetExactBudget, isExactBudgetError,
} from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 700;
// 정밀 모드: 완전탐색 범위·롤아웃을 키워 수학적 최적에 더 근접(느림). 무한로딩은 상한+폴백으로 방지.
const EXACT_THRESHOLD_PRECISE = 6;
const MC_ROLLOUTS_PRECISE = 2500;
// 밑장빼기는 게임당 1회뿐인 자원. 다시 굴리면 거의 항상 살짝 이득으로 보이므로,
// 승률이 이 폭(4%p) 이상 분명히 오를 때만 권장한다(남발 방지).
const MITJANG_MARGIN = 0.04;

export function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const baseSeed = opts.seed ?? 1234567;
  const precise = !!opts.precise;
  const threshold = precise ? EXACT_THRESHOLD_PRECISE : EXACT_THRESHOLD;
  const rollouts = precise ? MC_ROLLOUTS_PRECISE : MC_ROLLOUTS;
  const budget = defaultBudget(state);
  let exact = remainingEmpty(state) <= threshold;

  let built;
  try {
    if (exact) resetExactBudget();
    built = build(state, die, isBonus, exact, budget, baseSeed, rollouts);
  } catch (e) {
    // 완전탐색이 작업량 상한 초과 → 몬테카를로로 폴백(무한로딩 방지)
    if (exact && isExactBudgetError(e)) {
      exact = false;
      built = build(state, die, isBonus, false, budget, baseSeed, rollouts);
    } else {
      throw e;
    }
  }

  const { options, mitjang } = built;
  const best = options[0] ?? null;
  return { options, best, mitjang };
}

function build(state, die, isBonus, exact, budget, baseSeed, rollouts) {
  const evalMy = (L) =>
    exact
      ? exactMyPlacementValue(state, L, die, budget)
      : mcMyPlacementValue(state, L, die, rollouts, makeRng(baseSeed + 1 + L));
  const evalBonus = (t) =>
    exact
      ? exactBonusPlacementValue(state, t, die, budget)
      : mcBonusPlacementValue(state, t, die, rollouts, makeRng(baseSeed + 20 + (t.side === 'opp' ? 3 : 0) + t.lineIndex));

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

  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && options[0]) {
    const baseWinProb = options[0].winProb;
    const mitjangWinProb = mitjangValue(state, die, exact, budget, baseSeed, rollouts);
    mitjang = { recommend: mitjangWinProb > baseWinProb + MITJANG_MARGIN, baseWinProb, mitjangWinProb };
  }
  return { options, mitjang };
}

function bestMyValue(state, value, exact, budget, rng, rollouts) {
  let best = -Infinity;
  for (const L of legalLines(state, 'me')) {
    const wp = exact
      ? exactMyPlacementValue(state, L, value, budget)
      : mcMyPlacementValue(state, L, value, rollouts, rng);
    if (wp > best) best = wp;
  }
  return best === -Infinity ? 0 : best;
}

function mitjangValue(state, die, exact, budget, baseSeed, rollouts) {
  const consumed = setMitjang(state, 'me', false);
  const vDie = bestMyValue(consumed, die, exact, budget, makeRng(baseSeed + 100 + die), rollouts);
  let acc = 0;
  let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === die) continue;
    const vR2 = bestMyValue(consumed, r2, exact, budget, makeRng(baseSeed + 100 + r2), rollouts);
    acc += Math.max(vDie, vR2);
    n++;
  }
  return acc / n;
}
