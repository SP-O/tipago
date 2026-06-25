import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { azEncode, legalMask, actionToTarget, targetToAction, AZ_INPUT_SIZE, NUM_ACTIONS } from '../src/solver/az-encode.js';

const D = (v, s = false) => ({ value: v, shield: s });

test('azEncode: 길이 82, isBonus + die one-hot', () => {
  const f = azEncode(createState(), 'normal', 4);
  assert.equal(f.length, AZ_INPUT_SIZE);
  assert.equal(f.length, 82);
  assert.equal(f[75], 0); // isBonus=normal→0
  // die one-hot: 인덱스 76..81 = 값1..6. die=4 → 인덱스 76+3=79
  assert.equal(f[79], 1);
  assert.equal(f[76], 0);
});

test('azEncode bonus: isBonus=1', () => {
  const f = azEncode(createState(), 'bonus', 1);
  assert.equal(f[75], 1);
  assert.equal(f[76], 1); // die=1 → 인덱스 76
});

test('legalMask normal: 내 라인 빈칸만(상대는 0)', () => {
  const s = createState();
  s.me.lines[1] = [D(1), D(2), D(3)]; // 라인1 꽉참
  const m = legalMask(s, 'normal');
  assert.deepEqual(m, [1, 0, 1, 0, 0, 0]); // 내 라인0,2만
});

test('legalMask bonus: 양쪽 빈칸', () => {
  const s = createState();
  s.me.lines[0] = [D(1), D(2), D(3)];
  s.opp.lines[2] = [D(1), D(2), D(3)];
  const m = legalMask(s, 'bonus');
  assert.equal(m[0], 0); // 내 라인0 꽉
  assert.equal(m[1], 1);
  assert.equal(m[5], 0); // 상대 라인2 꽉
  assert.equal(m[3], 1); // 상대 라인0
});

test('action↔target 왕복', () => {
  assert.equal(NUM_ACTIONS, 6);
  for (let a = 0; a < 6; a++) {
    const t = actionToTarget(a);
    assert.equal(targetToAction(t.side, t.lineIndex), a);
  }
  assert.deepEqual(actionToTarget(0), { side: 'me', lineIndex: 0 });
  assert.deepEqual(actionToTarget(4), { side: 'opp', lineIndex: 1 });
});
