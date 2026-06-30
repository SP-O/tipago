import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boardStateToSt, scanGate } from '../../src/vision/st-writer.js';
import { recognizeFrame } from '../../src/vision/recognize.js';
import { toBoardState } from '../../src/vision/adapter.js';
import { loadPng } from './png.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const okLine = { lowConf: false, impossible: false };
const good = () => ({
  me: [[{ value: 2, shield: false }], [{ value: 1, shield: false }], []],
  opp: [[{ value: 4, shield: false }], [], []],
  rolledDie: 3, isMyTurn: true, bonusMode: false, clipped: false,
  anyImpossible: false, anyLowConf: false,
  lines: { me: [okLine, okLine, okLine], opp: [okLine, okLine, okLine] },
});

test('boardStateToSt: me/opp/die/bonusMode 매핑', () => {
  const r = boardStateToSt(good());
  assert.deepEqual(r.me, good().me);
  assert.deepEqual(r.opp, good().opp);
  assert.equal(r.die, 3);
  assert.equal(r.bonusMode, false);
});

test('scanGate: 정상 보드 = ok', () => {
  const g = scanGate(good());
  assert.equal(g.ok, true);
  assert.deepEqual(g.reasons, []);
});

test('scanGate: 내 턴 아니면 보류(notMyTurn)', () => {
  const b = good(); b.isMyTurn = false;
  const g = scanGate(b);
  assert.equal(g.ok, false);
  assert.ok(g.reasons.includes('notMyTurn'));
});

test('scanGate: 잘림이면 보류(clipped)', () => {
  const b = good(); b.clipped = true;
  assert.ok(scanGate(b).reasons.includes('clipped'));
});

test('scanGate: 저신뢰면 보류 + 해당 라인 표시', () => {
  const b = good(); b.anyLowConf = true; b.lines.me = [okLine, okLine, { lowConf: true, impossible: false }];
  const g = scanGate(b);
  assert.equal(g.ok, false);
  assert.ok(g.reasons.includes('lowConf'));
  assert.equal(g.lines.me[2].lowConf, true);
});

test('실결과(02): boardStateToSt die=숫자, 내 L2 packed=[1,1]', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png'))));
  const r = boardStateToSt(b);
  assert.deepEqual(r.me[1].map((d) => d.value), [1, 1]);
  assert.equal(typeof r.die, 'number');
});
