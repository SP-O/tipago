import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { searchValue, exactMyPlacementValue, defaultBudget } from '../src/solver/exact.js';

const D = (value, shield = false) => ({ value, shield });

// 거의 다 찬 보드: me가 라인0/1을 확정으로 이기고 라인2만 한 칸씩 남음
function nearEndState() {
  const s = createState();
  s.me.lines[0] = [D(6), D(6), D(6)];  // 30
  s.opp.lines[0] = [D(1), D(1), D(1)]; // 5  → me 승 확정
  s.me.lines[1] = [D(6), D(6), D(6)];  // 30
  s.opp.lines[1] = [D(1), D(1), D(1)]; // 5  → me 승 확정
  s.me.lines[2] = [D(1), D(1)];
  s.opp.lines[2] = [D(1), D(1)];
  s.me.hasMitjang = false;
  s.opp.hasMitjang = false;
  return s; // remainingEmpty = 2
}

test('defaultBudget: 빈칸 수 기반', () => {
  assert.ok(defaultBudget(nearEndState()) >= 2);
});

test('searchValue: 2라인 이미 승 확정 → 승률 1', () => {
  const s = nearEndState();
  // 라인2 결과와 무관하게 me가 라인0,1을 이미 이김 → 게임 승 확정
  assert.ok(Math.abs(searchValue(s, defaultBudget(s)) - 1) < 1e-9);
});

test('exactMyPlacementValue: 어느 칸에 둬도 승 확정', () => {
  const s = nearEndState();
  assert.ok(Math.abs(exactMyPlacementValue(s, 2, 5) - 1) < 1e-9);
});

test('searchValue: 졌을 때 0 (대칭 확인)', () => {
  const s = nearEndState();
  // me/opp 라인0,1을 뒤집어 opp가 두 라인 확정 승
  const swapped = {
    me: s.opp, opp: s.me, turn: 'me',
  };
  assert.ok(Math.abs(searchValue(swapped, defaultBudget(swapped)) - 0) < 1e-9);
});
