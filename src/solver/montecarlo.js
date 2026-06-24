import { cloneState, boardFull } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import { endTurn, placeDie, resolveAlkkagi, wouldTriggerAlkkagi } from '../rules.js';
import { rollDie, greedyMove, greedyBonusPlace } from './evaluate.js';

const ROLLOUT_CAP = 40;

export function rollout(state, rng) {
  let s = cloneState(state);
  let depth = 0;
  while (!boardFull(s) && depth < ROLLOUT_CAP) {
    const player = s.turn;
    const r = rollDie(rng);
    const move = greedyMove(s, r, rng);
    if (!move) break;
    if (move.alkkagi) {
      s = resolveAlkkagi(s, player, move.lineIndex, r);
      const b = rollDie(rng);
      s = greedyBonusPlace(s, player, b, rng);
      s = endTurn(s);
    } else {
      s = endTurn(placeDie(s, player, move.lineIndex, { value: r, shield: false }));
    }
    depth++;
  }
  return outcomeValue(gameResult(s));
}

export function montecarloValue(state, n, rng) {
  let total = 0;
  for (let k = 0; k < n; k++) total += rollout(state, rng);
  return total / n;
}

export function mcMyPlacementValue(state, lineIndex, value, n, rng) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    let total = 0;
    for (let k = 0; k < n; k++) {
      let s1 = resolveAlkkagi(state, 'me', lineIndex, value);
      const b = rollDie(rng);
      s1 = greedyBonusPlace(s1, 'me', b, rng);
      total += rollout(endTurn(s1), rng);
    }
    return total / n;
  }
  const s = endTurn(placeDie(state, 'me', lineIndex, { value, shield: false }));
  return montecarloValue(s, n, rng);
}

export function mcBonusPlacementValue(state, target, value, n, rng) {
  const s = endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true }));
  return montecarloValue(s, n, rng);
}
