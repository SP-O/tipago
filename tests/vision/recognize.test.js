import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const vals = (line) => line.map((c) => (c ? c.value : -1));

test('recognizeFrame(02): 값 정확 + 씨앗=1 + 턴/모드/잘림', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  assert.deepEqual(vals(r.cells.me[1]), [0, 1, 1]);   // 내 L2: 빈,씨앗,씨앗 (점세기는 2,2로 실패했던 칸 — 템플릿으로 정확)
  assert.deepEqual(vals(r.cells.me[0]), [2, 2, 3]);   // 내 L1
  assert.deepEqual(vals(r.cells.opp[0]), [4, 5, 0]);  // 상대 L1 (3번째 빈칸)
  assert.equal(r.clipped, false);
  assert.equal(r.isMyTurn, true);                     // 좌측 홀딩박스에 주사위
  assert.equal(r.bonusMode, false);                   // 02엔 상대라인 흰테두리 없음
});

test('recognizeFrame(08-enemy-turn): 빈 홀딩박스 → 내 턴 아님', () => {
  const r = recognizeFrame(loadPng(join(FIX, '08-enemy-turn.PNG')));
  assert.equal(r.isMyTurn, false);
});

test('recognizeFrame(07-after-3): 하단 잘림 감지', () => {
  const r = recognizeFrame(loadPng(join(FIX, '07-alkkagi-after-3.png')));
  assert.equal(r.clipped, true); // 일부 칸이 프레임 밖
});

test('recognizeFrame(02): 모든 칸 conf 숫자', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  const flat = [...r.cells.me, ...r.cells.opp].flat().filter(Boolean);
  assert.ok(flat.every((c) => typeof c.conf === 'number'));
});

test('recognizeFrame: 작은/이상 프레임에도 isMyTurn=false (NaN 안전)', () => {
  const frame = { data: new Uint8ClampedArray(50 * 50 * 4).fill(100), width: 50, height: 50 };
  const r = recognizeFrame(frame);
  assert.equal(r.isMyTurn, false);
});
