import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardSignature, createAutoloopState, autoloopStep } from '../../src/vision/autoloop.js';
import { scanGate } from '../../src/vision/st-writer.js';

const D = (v, s = false) => ({ value: v, shield: s });
function board(o = {}) {
  return {
    me: o.me || [[D(6), D(6)], [D(4)], []],
    opp: o.opp || [[D(5), D(5), D(4)], [], []],
    rolledDie: o.rolledDie ?? 6,
    isMyTurn: o.isMyTurn ?? true,
    bonusMode: o.bonusMode ?? false,
    clipped: o.clipped ?? false,
    anyLowConf: o.anyLowConf ?? false,
    anyImpossible: o.anyImpossible ?? false,
    lines: o.lines || { me: [{}, {}, {}], opp: [{}, {}, {}] },
  };
}
// 같은 board를 n프레임 먹인 뒤 마지막 action/state 반환
function feed(state, b, n) {
  let action;
  for (let i = 0; i < n; i++) { const r = autoloopStep(state, b, scanGate(b)); state = r.state; action = r.action; }
  return { state, action };
}

test('boardSignature: 같은 보드는 같은 서명, 값/실드/주사위/보너스 바뀌면 다른 서명', () => {
  const b = board();
  assert.equal(boardSignature(b), boardSignature(board()));
  assert.notEqual(boardSignature(b), boardSignature(board({ rolledDie: 5 })));
  assert.notEqual(boardSignature(b), boardSignature(board({ bonusMode: true })));
  assert.notEqual(boardSignature(b), boardSignature(board({ me: [[D(6), D(6, true)], [D(4)], []] })));
  assert.notEqual(boardSignature(b), boardSignature(board({ opp: [[D(5), D(5), D(3)], [], []] })));
});

test('autoloopStep: 상대 턴이면 idle(계산 안 함)', () => {
  const b = board({ isMyTurn: false });
  const r = autoloopStep(createAutoloopState(), b, scanGate(b));
  assert.equal(r.action, 'idle');
});

test('autoloopStep: 내 턴 정상 인식은 연속 2프레임 후 commit(안정화)', () => {
  const b = board();
  let st = createAutoloopState();
  const r1 = autoloopStep(st, b, scanGate(b)); st = r1.state;
  assert.equal(r1.action, 'wait');           // 1프레임: 대기
  const r2 = autoloopStep(st, b, scanGate(b));
  assert.equal(r2.action, 'commit');         // 2프레임: 커밋
});

test('autoloopStep: 커밋한 상태를 다시 먹이면 idle(중복 계산 방지)', () => {
  const b = board();
  const { state } = feed(createAutoloopState(), b, 2); // commit됨
  const again = autoloopStep(state, b, scanGate(b));
  assert.equal(again.action, 'idle');
});

test('autoloopStep: 인식 애매(lowConf)면 안정화돼도 commit 안 하고 ambiguous', () => {
  const b = board({ anyLowConf: true });
  const { action, state } = feed(createAutoloopState(), b, 3);
  assert.equal(action, 'ambiguous');
  assert.equal(state.committedSig, null); // 쓰레기 자동 커밋 안 함
});

test('autoloopStep: 재롤(상대 턴 지나 보드 바뀜) → 다시 commit', () => {
  let st = createAutoloopState();
  // 첫 롤(die=6) 커밋
  st = feed(st, board({ rolledDie: 6 }), 2).state;
  // 상대 턴
  st = autoloopStep(st, board({ isMyTurn: false }), scanGate(board({ isMyTurn: false }))).state;
  // 다시 내 턴, 같은 die=6이지만 상대가 한 수 둬서 보드가 달라짐
  const b2 = board({ rolledDie: 6, opp: [[D(5), D(5), D(4)], [D(2)], []] });
  const { action } = feed(st, b2, 2);
  assert.equal(action, 'commit'); // 서명이 달라 재계산
});
