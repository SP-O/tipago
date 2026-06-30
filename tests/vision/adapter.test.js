import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packLine, toBoardState } from '../../src/vision/adapter.js';
import { recognizeFrame } from '../../src/vision/recognize.js';
import { loadPng } from './png.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const R = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });
const C = (value, shield = false, conf = 9) => ({ value, shield, conf });
const E = { value: 0, shield: false, conf: 9 }; // 빈칸

test('packLine(me): 우→좌 채움 순서', () => {
  // 화면 [빈, 3, 5] (cell0빈,cell1=3,cell2=5) → 내 필드는 cell2 먼저 → [5,3]
  const r = packLine([E, C(3), C(5)], 'me');
  assert.deepEqual(r.line, [{ value: 5, shield: false }, { value: 3, shield: false }]);
  assert.equal(r.impossible, false);
});

test('packLine(opp): 좌→우 채움 순서', () => {
  // 화면 [4,5,빈] → 상대는 cell0 먼저 → [4,5]
  const r = packLine([C(4), C(5), E], 'opp');
  assert.deepEqual(r.line, [{ value: 4, shield: false }, { value: 5, shield: false }]);
});

test('packLine: 불가능한 갭 감지', () => {
  // 내 필드 화면 [채움, 빈, 채움] → 채움-시작(우)부터 연속 아님 → impossible
  const r = packLine([C(2), E, C(6)], 'me');
  assert.equal(r.impossible, true);
});

test('toBoardState(02): packed 보드 + 잘림없음', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png'))));
  assert.equal(b.clipped, false);
  assert.equal(b.anyImpossible, false);
  // 내 L2 화면 [빈,씨앗,씨앗] → me 우→좌 packed [1,1]
  assert.deepEqual(b.me[1].map((d) => d.value), [1, 1]);
});

test('toBoardState: 라인 단위 lines{me,opp} 제공', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png'))));
  assert.equal(b.lines.me.length, 3);
  assert.equal(b.lines.opp.length, 3);
  for (const l of [...b.lines.me, ...b.lines.opp]) {
    assert.equal(typeof l.lowConf, 'boolean');
    assert.equal(typeof l.impossible, 'boolean');
  }
});

test('toBoardState: NaN conf도 저신뢰로 취급(anyLowConf true)', () => {
  const E = { value: 0, shield: false, conf: Infinity };
  const nanCell = { value: 3, shield: false, conf: NaN };
  const rec = {
    cells: { me: [[E, E, nanCell], [E, E, E], [E, E, E]], opp: [[E, E, E], [E, E, E], [E, E, E]] },
    rolledDie: 0, isMyTurn: false, bonusMode: false, clipped: false,
  };
  assert.equal(toBoardState(rec).anyLowConf, true);
});

test('toBoardState(라이브 11/14): 정상 보드는 anyLowConf 아님(CONF_MIN 0.1)', () => {
  for (const [n, rect] of [['11-live.png', R(885,653)], ['14-live.png', R(894,616)]]) {
    const b = toBoardState(recognizeFrame(loadPng(join(FIX, n)), rect));
    assert.equal(b.anyLowConf, false, `${n} anyLowConf`);
  }
});
