import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { searchValue, exactMyPlacementValue, defaultBudget, resetExactBudget } from '../src/solver/exact.js';

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

// 회귀: 상대 필드가 먼저 꽉 차도 나는 내 빈칸이 찰 때까지 계속 둔다("판이 꽉 찰 때까지").
// 아래는 수학적 확정승(=1.0)이어야 한다:
//   - 라인0: me 30 vs opp 5, 양쪽 full → me 승 확정(1라인 잠금)
//   - 라인1: me 18(빈칸1) vs opp 19 full → 어떤 주사위든 라인1에서 opp가 이길 길 없음(최악 무승부)
//   - 라인2: me 빈(3칸) vs opp 5 full → me 최악 무승부
//   opp가 이길 수 있는 라인이 하나도 없고 me는 라인0을 잠갔으므로 me 무조건 승.
// 트렁케이션 버그가 있으면 opp(꽉 참)가 둘 차례에서 게임을 조기 종료해 내 남은 칸을 못 채우고 <1 로 저평가됨.
// 상대 주사위는 모두 실드 → 알까기 분기 없음(완전탐색이 NODE_LIMIT 안에서 정확히 1.0을 냄).
// 실드는 알까기만 막을 뿐 "me가 이긴다"는 결론엔 영향 없음.
function oppFullMeDevelops() {
  const s = createState();
  s.me.lines[0] = [D(6), D(6), D(6)];               // 30 full
  s.opp.lines[0] = [D(1, true), D(1, true), D(1, true)]; // 5 full  → me 승 잠금
  s.me.lines[1] = [D(6), D(6)];                     // 18, 1칸 남음
  s.opp.lines[1] = [D(5, true), D(5, true), D(4, true)]; // 19 full
  s.me.lines[2] = [];                               // 3칸 남음
  s.opp.lines[2] = [D(1, true), D(1, true), D(1, true)]; // 5 full
  s.me.hasMitjang = false;
  s.opp.hasMitjang = false;
  return s; // remainingEmpty = 4 → exact 경로
}

test('완전탐색: 상대 먼저 꽉 참 + 내 빈칸 남음 → 전개 수도 확정승(트렁케이션 회귀)', () => {
  const s = oppFullMeDevelops();
  // 6을 (이미 잠근 라인1이 아니라) 라인2에 전개해도 여전히 100% 확정승이어야 한다.
  resetExactBudget();
  const vDev = exactMyPlacementValue(s, 2, 6);
  assert.ok(Math.abs(vDev - 1) < 1e-9, `전개 수(라인2)가 확정승이어야 하는데 ${vDev}`);
  // 포지션 자체의 값도 1.0.
  resetExactBudget();
  const vPos = searchValue(s, defaultBudget(s));
  assert.ok(Math.abs(vPos - 1) < 1e-9, `포지션 값이 1이어야 하는데 ${vPos}`);
});

test('searchValue: 졌을 때 0 (대칭 확인)', () => {
  const s = nearEndState();
  // me/opp 라인0,1을 뒤집어 opp가 두 라인 확정 승
  const swapped = {
    me: s.opp, opp: s.me, turn: 'me',
  };
  assert.ok(Math.abs(searchValue(swapped, defaultBudget(swapped)) - 0) < 1e-9);
});
