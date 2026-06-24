import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { makeRng } from '../src/solver/evaluate.js';
import { createNet } from '../src/solver/net.js';
import { nnRecommend, executeTurn, stateValue } from '../src/solver/nn-search.js';

const D = (v, s = false) => ({ value: v, shield: s });

test('stateValue: 종료 보드는 실제 결과(무승부=0.5)', () => {
  const net = createNet([75, 8, 1], makeRng(1));
  const s = createState();
  for (const p of ['me', 'opp']) for (const l of s[p].lines) l.push(D(1), D(1), D(1));
  assert.equal(stateValue(net, s, 2, 6, makeRng(2)), 0.5);
});

test('nnRecommend: 형식·범위·정렬', () => {
  const net = createNet([75, 16, 1], makeRng(3));
  const r = nnRecommend(net, createState(), 4, { depth: 1, samples: 6, rng: makeRng(4) });
  assert.ok(r.options.length > 0);
  for (const o of r.options) assert.ok(o.winProb >= 0 && o.winProb <= 1);
  assert.equal(r.best, r.options[0]);
  for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].winProb >= r.options[i].winProb);
});

test('executeTurn: 턴 전환 + 첫 주사위는 실드로 1개 배치', () => {
  const net = createNet([75, 16, 1], makeRng(5));
  const s1 = executeTurn(net, createState({ turn: 'me' }), makeRng(6), { depth: 0, samples: 2, temperature: 0 }, true);
  assert.equal(s1.turn, 'opp');
  const total = s1.me.lines.reduce((a, l) => a + l.length, 0);
  assert.equal(total, 1);
  assert.equal(s1.me.lines.flat()[0].shield, true);
});
