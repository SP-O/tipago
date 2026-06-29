import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { makeRng, rollDie, pAtLeastTwo, lineWinProb, heuristicValue, greedyMove } from '../src/solver/evaluate.js';

const D = (value, shield = false) => ({ value, shield });

test('makeRng: 같은 시드 = 같은 수열(결정적)', () => {
  const a = makeRng(42); const b = makeRng(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('rollDie: 1~6 범위', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 200; i++) {
    const v = rollDie(rng);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v));
  }
});

test('pAtLeastTwo: 경계값', () => {
  assert.equal(pAtLeastTwo(1, 1, 1), 1);
  assert.equal(pAtLeastTwo(0, 0, 0), 0);
  assert.ok(Math.abs(pAtLeastTwo(0.5, 0.5, 0.5) - 0.5) < 1e-9);
});

test('lineWinProb: 앞서면 0.5 초과, 뒤지면 0.5 미만', () => {
  const s = createState();
  s.me.lines[0] = [D(6), D(6)]; // 18
  s.opp.lines[0] = [D(2)];      // 2
  assert.ok(lineWinProb(s, 0) > 0.5);
  assert.ok(lineWinProb(s, 1) > 0.49 && lineWinProb(s, 1) < 0.51); // 빈 라인 무승부 근처
  const s2 = createState();
  s2.opp.lines[0] = [D(6), D(6)];
  assert.ok(lineWinProb(s2, 0) < 0.5);
});

test('heuristicValue: 모든 라인 압도 시 1에 근접', () => {
  const s = createState();
  for (let i = 0; i < 3; i++) { s.me.lines[i] = [D(6), D(6)]; s.opp.lines[i] = [D(1)]; }
  assert.ok(heuristicValue(s) > 0.9);
});

test('greedyMove: 상대 중복 제거각(알까기)을 선택', () => {
  const s = createState();
  s.opp.lines[0] = [D(6), D(6)]; // 라인0에 6 두 개 → 알까기로 제거 가능
  const move = greedyMove(s, 6, makeRng(7));
  assert.equal(move.lineIndex, 0);
  assert.equal(move.alkkagi, true);
});

test('greedyMove: 이미 이기는 줄을 자해 알까기로 열지 않는다', () => {
  // me L0=9로 이미 이기는 줄. opp L0=[1,1] 비실드 → 1을 내면 알까기 트리거되지만,
  // 그 줄을 열면 상대가 빈칸을 되채워 역전 가능 → 알까기 대신 다른 곳에 둬야 함.
  const s = {
    me: { lines: [[D(6), D(3)], [], []], hasMitjang: false },
    opp: { lines: [[D(1), D(1)], [], []], hasMitjang: false },
    turn: 'me',
  };
  const mv = greedyMove(s, 1, makeRng(1));
  assert.equal(mv.alkkagi, false);
});

test('greedyMove: 지는 줄은 여전히 알까기로 제거각을 살린다', () => {
  // me L0=2로 지는 줄 → 알까기 허용(자해 아님).
  const s = {
    me: { lines: [[D(2)], [], []], hasMitjang: false },
    opp: { lines: [[D(6), D(6)], [], []], hasMitjang: false },
    turn: 'me',
  };
  const mv = greedyMove(s, 6, makeRng(1));
  assert.equal(mv.alkkagi, true);
  assert.equal(mv.lineIndex, 0);
});
