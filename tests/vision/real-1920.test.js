// 실측 1920 창모드 회귀: 굴린 5가 3(또는 1)으로 뒤집혀 계산이 깜빡인 버그.
// 근본원인은 3/5 유사성이 아니라 "스케일 민감도" — srcSize를 캘리브레이션 cs에서 뽑는데
// 창모드 box-drag cs가 실제 주사위보다 커서 srcSize 과대 → 5가 엉뚱하게 매칭됨.
// 실측 주사위 블롭 크기에서 srcSize를 뽑으면 캘리브레이션 오차에 강인해져 5로 안정 인식.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const F16 = join(FIX, '16-real-1920-five.png');
const skip = !existsSync(F16) && 'vision-fixtures 없음(로컬 전용)';

test('실제 1920 굴린 5: cs 과대 캘리브레이션에도 5로 인식', { skip }, () => {
  // holdMine이 굴린 주사위(≈530,627)에 오도록 구성한, cs가 과대(=76)한 boardRect.
  // 실제 주사위면은 ~60px라 캘리브레이션 cs와 어긋난 상황(사용자 창모드 재현).
  const rect = { x: 587, y: 421, w: 930, h: 412 };
  const r = recognizeFrame(loadPng(F16), rect);
  assert.equal(r.isMyTurn, true);
  assert.equal(r.rolledDie, 5, `굴린 주사위는 5여야 (srcSize 과대 시 현행은 오분류)`);
});
