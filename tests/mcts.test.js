import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/solver/evaluate.js';
import { createAzNet } from '../src/solver/az-net.js';
import { AZ_INPUT_SIZE } from '../src/solver/az-encode.js';
import { mctsSearch } from '../src/solver/mcts.js';

const D = (v, s = false) => ({ value: v, shield: s });
const net = createAzNet([AZ_INPUT_SIZE, 16], 6, makeRng(1)); // 랜덤(미학습) 망

test('MCTS: 유일한 수가 확정 승이면 winProb≈1 (종료값 역전파)', () => {
  // me 라인0,1 확정 승(꽉참). 라인2만 내 1칸 남음. 둘 곳은 라인2뿐.
  const s = {
    me: { lines: [[D(6), D(6), D(6)], [D(6), D(6), D(6)], [D(6), D(6)]], hasMitjang: false },
    opp: { lines: [[D(1), D(1), D(1)], [D(1), D(1), D(1)], [D(1), D(1), D(1)]], hasMitjang: false },
    turn: 'me',
  };
  const r = mctsSearch(net, s, 'normal', 6, { sims: 60, rng: makeRng(2) });
  assert.equal(r.best.target.lineIndex, 2);
  assert.ok(r.best.winProb > 0.99, `winProb=${r.best.winProb}`);
});

test('MCTS: 유일한 수가 확정 패면 winProb≈0', () => {
  const s = {
    me: { lines: [[D(1), D(1), D(1)], [D(1), D(1), D(1)], [D(1), D(1)]], hasMitjang: false },
    opp: { lines: [[D(2), D(2), D(2)], [D(6), D(6), D(6)], [D(6), D(6), D(6)]], hasMitjang: false },
    turn: 'me',
  };
  // 내 라인2에 1 두면(알까기 없음: opp 라인2=6,6,6 ≠ 1) 보드 꽉참 → me 전패
  const r = mctsSearch(net, s, 'normal', 1, { sims: 60, rng: makeRng(3) });
  assert.equal(r.best.target.lineIndex, 2);
  assert.ok(r.best.winProb < 0.01, `winProb=${r.best.winProb}`);
});

test('MCTS: 옵션은 방문수 내림차순, winProb 0~1', () => {
  const s = {
    me: { lines: [[], [], []], hasMitjang: false },
    opp: { lines: [[D(6), D(6)], [], []], hasMitjang: false },
    turn: 'me',
  };
  const r = mctsSearch(net, s, 'normal', 6, { sims: 80, rng: makeRng(4) });
  assert.ok(r.options.length > 0);
  for (const o of r.options) assert.ok(o.winProb >= 0 && o.winProb <= 1);
  for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].visits <= r.options[i - 1].visits + r.options[i].visits);
  // 방문수 내림차순
  for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].visits >= r.options[i].visits);
});

test('MCTS: 알까기 가능 표시 정확', () => {
  const s = {
    me: { lines: [[], [], []], hasMitjang: false },
    opp: { lines: [[D(6), D(6)], [], []], hasMitjang: false },
    turn: 'me',
  };
  const r = mctsSearch(net, s, 'normal', 6, { sims: 40, rng: makeRng(5) });
  const line0 = r.options.find((o) => o.target.side === 'me' && o.target.lineIndex === 0);
  assert.equal(line0.alkkagi, true); // 내 라인0에 6 두면 상대 6,6 알까기
});
