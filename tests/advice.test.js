import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topLead, isCloseCall } from '../src/solver/advice.js';

const O = (...ps) => ps.map((winProb) => ({ winProb }));

test('topLead: 1등과 2등 승률 차', () => {
  assert.ok(Math.abs(topLead(O(0.95, 0.93, 0.90)) - 0.02) < 1e-9);
  assert.equal(topLead(O(0.8)), Infinity); // 비교 대상 없음
  assert.equal(topLead([]), Infinity);
});

test('isCloseCall: 상위 선택지가 근소하면 true(직감에 맡김)', () => {
  assert.equal(isCloseCall(O(0.95, 0.93, 0.90)), true);   // 리드 0.02
  assert.equal(isCloseCall(O(0.87, 0.62, 0.59)), false);  // 리드 0.25 = 명확한 1등
  assert.equal(isCloseCall(O(0.95, 0.70, 0.68)), false);  // 1등 확실
  assert.equal(isCloseCall(O(0.40, 0.38, 0.37)), true);   // 지는 판이어도 근소하면 직감
});

test('isCloseCall: 선택지 1개면 false(비교 대상 없음)', () => {
  assert.equal(isCloseCall(O(0.9)), false);
  assert.equal(isCloseCall([]), false);
  assert.equal(isCloseCall(null), false);
});

test('isCloseCall: margin 파라미터 적용', () => {
  assert.equal(isCloseCall(O(0.90, 0.86), 0.05), true);   // 리드 0.04 <= 0.05
  assert.equal(isCloseCall(O(0.90, 0.80), 0.05), false);  // 리드 0.10 > 0.05
});
