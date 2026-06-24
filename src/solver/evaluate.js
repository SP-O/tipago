import { lineSum } from '../scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie } from '../rules.js';

const HEUR_K = 7;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

export function pAtLeastTwo(a, b, c) {
  return a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c + a * b * c;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function dupCount(line) {
  // 같은 값(비실드)이 2개 이상인 주사위 개수 (0/2/3)
  const counts = {};
  for (const d of line) if (!d.shield) counts[d.value] = (counts[d.value] || 0) + 1;
  let dup = 0;
  for (const v in counts) if (counts[v] >= 2) dup += counts[v];
  return dup;
}

export function lineWinProb(state, i) {
  const my = lineSum(state.me.lines[i]);
  const op = lineSum(state.opp.lines[i]);
  let margin = my - op;
  // 상대 비실드 중복 → 내가 제거각 → 유리 가산
  margin += dupCount(state.opp.lines[i]) * 1.5;
  // 내 비실드 중복 → 상대가 제거각 → 불리 감산
  margin -= dupCount(state.me.lines[i]) * 1.0;
  // 양쪽 라인 꽉 찼고 내가 뒤지면 굳어진 패배 → 추가 페널티
  if (state.me.lines[i].length === 3 && state.opp.lines[i].length === 3 && margin < 0) margin -= 2;
  return clamp(1 / (1 + Math.exp(-margin / HEUR_K)), 0.02, 0.98);
}

export function heuristicValue(state) {
  const p = [0, 1, 2].map((i) => lineWinProb(state, i));
  return pAtLeastTwo(p[0], p[1], p[2]);
}

export function chooseScore(player, state) {
  const h = heuristicValue(state);
  return player === 'me' ? h : 1 - h;
}

export function greedyMove(state, value, rng) {
  const player = state.turn;
  const lines = legalLines(state, player);
  if (lines.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const L of lines) {
    const alkkagi = wouldTriggerAlkkagi(state, player, L, value);
    const next = alkkagi
      ? resolveAlkkagi(state, player, L, value)
      : placeDie(state, player, L, { value, shield: false });
    const sc = chooseScore(player, next) + rng() * 1e-6; // 동점 시 미세 난수
    if (sc > bestScore) {
      bestScore = sc;
      best = { lineIndex: L, alkkagi };
    }
  }
  return best;
}

export function greedyBonusPlace(state, player, b, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return state;
  let best = state;
  let bestScore = -Infinity;
  for (const t of targets) {
    const next = placeDie(state, t.side, t.lineIndex, { value: b, shield: true });
    const sc = chooseScore(player, next) + rng() * 1e-6;
    if (sc > bestScore) {
      bestScore = sc;
      best = next;
    }
  }
  return best;
}
