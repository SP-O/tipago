import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, cloneState, opponentOf, boardFull, remainingEmpty } from '../src/state.js';

test('createState: 빈 보드, me는 밑장빼기 보유', () => {
  const s = createState();
  assert.equal(s.turn, 'me');
  assert.equal(s.me.hasMitjang, true);
  assert.equal(s.opp.hasMitjang, false);
  assert.deepEqual(s.me.lines, [[], [], []]);
  assert.equal(remainingEmpty(s), 18);
  assert.equal(boardFull(s), false);
});

test('opponentOf', () => {
  assert.equal(opponentOf('me'), 'opp');
  assert.equal(opponentOf('opp'), 'me');
});

test('cloneState: 독립 복제(원본 불변)', () => {
  const s = createState();
  const c = cloneState(s);
  c.me.lines[0].push({ value: 5, shield: false });
  assert.equal(s.me.lines[0].length, 0);
  assert.equal(c.me.lines[0].length, 1);
});

test('boardFull/remainingEmpty: 18칸 채우면 종료', () => {
  const s = createState();
  for (const p of ['me', 'opp']) for (const l of s[p].lines) l.push({ value: 1, shield: false }, { value: 2, shield: false }, { value: 3, shield: false });
  assert.equal(remainingEmpty(s), 0);
  assert.equal(boardFull(s), true);
});
