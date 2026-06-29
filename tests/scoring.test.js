import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineSum, lineResult, gameResult, outcomeValue, decidedResult } from '../src/scoring.js';

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

test('gameResult: 1:1:동점 → 총합 높은 쪽 승(me)', () => {
  const s = {
    me: { lines: [[D(6)], [D(5)], [D(4)]], hasMitjang: true },   // 6,5,4 = 15
    opp: { lines: [[D(1)], [D(6)], [D(4)]], hasMitjang: false }, // 1,6,4 = 11
    turn: 'me',
  };
  // line0 me, line1 opp, line2 동점 → 1:1:동점 → 총합 15>11 → me
  assert.equal(gameResult(s), 'me');
});

test('gameResult: 1:1:동점 → 총합 낮으면 패(opp)', () => {
  const s = {
    me: { lines: [[D(6)], [D(2)], [D(5)]], hasMitjang: true },   // 13
    opp: { lines: [[D(5)], [D(6)], [D(5)]], hasMitjang: false }, // 16
    turn: 'me',
  };
  assert.equal(gameResult(s), 'opp');
});

test('gameResult: 라인 동률 + 총합도 같으면 무승부', () => {
  const s = {
    me: { lines: [[D(6)], [D(2)], [D(5)]], hasMitjang: true },   // 13
    opp: { lines: [[D(2)], [D(6)], [D(5)]], hasMitjang: false }, // 13
    turn: 'me',
  };
  // line0 me, line1 opp, line2 동점, 총합 13=13 → draw
  assert.equal(gameResult(s), 'draw');
});

test('outcomeValue', () => {
  assert.equal(outcomeValue('me'), 1);
  assert.equal(outcomeValue('draw'), 0.5);
  assert.equal(outcomeValue('opp'), 0);
});

test('decidedResult: 상대 줄이 꽉 차고 내가 앞선 라인 2개면 me 확정(내 줄은 미완성이어도)', () => {
  const s = {
    me: { lines: [[D(6), D(3)], [D(4), D(5)], [D(1)]], hasMitjang: false },     // L1=9, L2=9
    opp: { lines: [[D(1), D(2), D(1)], [D(4), D(3), D(2)], [D(2)]], hasMitjang: false }, // L1=5(full), L2=9(full)
    turn: 'me',
  };
  // L1: opp full(5) & me 9>5 → 잠김. L2: opp full(9) & me 9>9? 아님(동점) → 미잠김.
  assert.equal(decidedResult(s), null);
  // L2에 4를 더해 17로 만들면 두 라인 잠김
  s.me.lines[1] = [D(4), D(5), D(4)]; // 17
  assert.equal(decidedResult(s), 'me');
});

test('decidedResult: 대칭(opp 확정) + 미결정은 null', () => {
  const sOpp = {
    me: { lines: [[D(1), D(1), D(1)], [D(2), D(2), D(2)], [D(6)]], hasMitjang: false },   // L1=3(full), L2=6(full)
    opp: { lines: [[D(6), D(6)], [D(5), D(5)], [D(1)]], hasMitjang: false },              // L1=18>3, L2=15>6
    turn: 'me',
  };
  assert.equal(decidedResult(sOpp), 'opp');
  const sOpen = {
    me: { lines: [[D(6)], [D(6)], [D(6)]], hasMitjang: false },
    opp: { lines: [[D(1)], [D(1)], [D(1)]], hasMitjang: false }, // 아무 줄도 안 찼음
    turn: 'me',
  };
  assert.equal(decidedResult(sOpen), null);
});
