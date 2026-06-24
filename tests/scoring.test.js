import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineSum, lineResult, gameResult, outcomeValue } from '../src/scoring.js';

const D = (value, shield = false) => ({ value, shield });

test('lineSum: 단순합/더블/트리플/혼합', () => {
  assert.equal(lineSum([D(3), D(1)]), 4);
  assert.equal(lineSum([D(5), D(5)]), 15);        // 더블
  assert.equal(lineSum([D(5), D(5), D(5)]), 25);  // 트리플
  assert.equal(lineSum([D(3), D(3), D(5)]), 14);  // 3더블(9) + 5
  assert.equal(lineSum([]), 0);
});

test('lineSum: 실드도 동일하게 계산', () => {
  assert.equal(lineSum([D(6, true), D(6, false)]), 18); // 더블
});

test('lineResult', () => {
  assert.equal(lineResult([D(6)], [D(5)]), 'me');
  assert.equal(lineResult([D(4)], [D(6)]), 'opp');
  assert.equal(lineResult([D(5)], [D(5)]), 'draw');
});

test('gameResult: 2라인 승=게임 승', () => {
  const s = {
    me: { lines: [[D(6)], [D(6)], [D(1)]], hasMitjang: true },
    opp: { lines: [[D(5)], [D(5)], [D(6)]], hasMitjang: false },
    turn: 'me',
  };
  assert.equal(gameResult(s), 'me');
});

test('gameResult: 1:1:동점 → 전체 무승부', () => {
  const s = {
    me: { lines: [[D(6)], [D(2)], [D(5)]], hasMitjang: true },
    opp: { lines: [[D(5)], [D(6)], [D(5)]], hasMitjang: false },
    turn: 'me',
  };
  assert.equal(gameResult(s), 'draw');
});

test('outcomeValue', () => {
  assert.equal(outcomeValue('me'), 1);
  assert.equal(outcomeValue('draw'), 0.5);
  assert.equal(outcomeValue('opp'), 0);
});
