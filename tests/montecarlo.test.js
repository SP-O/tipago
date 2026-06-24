import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { makeRng } from '../src/solver/evaluate.js';
import { rollout, montecarloValue, mcMyPlacementValue } from '../src/solver/montecarlo.js';

const D = (value, shield = false) => ({ value, shield });

test('rollout: 항상 0/0.5/1 중 하나', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 20; i++) {
    const v = rollout(createState(), rng);
    assert.ok(v === 0 || v === 0.5 || v === 1);
  }
});

test('montecarloValue: 0~1 범위', () => {
  const v = montecarloValue(createState(), 50, makeRng(5));
  assert.ok(v >= 0 && v <= 1);
});

test('mcMyPlacementValue: 압도적으로 이긴 보드 마무리 → 높은 승률', () => {
  // me가 두 라인 이미 크게 이기고, 마지막 한 칸만 채우면 끝나는 상황
  const s = createState();
  s.me.lines[0] = [D(6), D(6), D(6)];   // 30
  s.opp.lines[0] = [D(1), D(1), D(1)];  // 5
  s.me.lines[1] = [D(6), D(6), D(6)];   // 30
  s.opp.lines[1] = [D(1), D(1), D(1)];  // 5
  s.me.lines[2] = [D(1), D(1)];
  s.opp.lines[2] = [D(1), D(1)]; // 양쪽 라인2에 각각 1칸 남음
  const wp = mcMyPlacementValue(s, 2, 3, 200, makeRng(9));
  assert.ok(wp > 0.95, `expected >0.95, got ${wp}`);
});
