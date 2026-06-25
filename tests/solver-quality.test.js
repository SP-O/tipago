// 프로 전략 글의 원칙을 솔버가 지키는지 검증하는 회귀 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/solver/recommend.js';
import { lineWinProb } from '../src/solver/evaluate.js';

const D = (v, s = false) => ({ value: v, shield: s });
const mk = (meLines, oppLines, o = {}) => ({
  me: { lines: meLines, hasMitjang: o.meM ?? false },
  opp: { lines: oppLines, hasMitjang: o.oppM ?? false },
  turn: 'me',
});

test('프로전략: 상대 트리플은 알까기로 제거 추천', () => {
  const s = mk([[], [], []], [[D(4), D(4), D(4)], [], []]);
  const r = recommend(s, 4, { seed: 1 });
  assert.equal(r.best.alkkagi, true);
  assert.equal(r.best.target.lineIndex, 0);
});

test('프로전략: 고점(6) 보너스는 내 필드에 배치(상대에 안 줌)', () => {
  const s = mk([[D(5)], [], [D(1)]], [[D(6)], [], [D(4)]]);
  const r = recommend(s, 6, { isBonus: true, seed: 1 });
  assert.equal(r.best.target.side, 'me');
});

test('평가: 상대 합이 같아도 제거각 큰 라인을 더 유리하게(더블3 > 단일5,4)', () => {
  const dbl = mk([[], [], []], [[D(3), D(3)], [], []]); // 합9, 제거가치9
  const sgl = mk([[], [], []], [[D(5), D(4)], [], []]); // 합9, 제거가치5
  assert.ok(lineWinProb(dbl, 0) > lineWinProb(sgl, 0));
});
