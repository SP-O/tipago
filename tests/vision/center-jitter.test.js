// 잔여 5→3 깜빡임 회귀: srcSize를 실측으로 고쳐도 라이브에선 블롭 중심이 프레임마다 ±몇px
// 흔들려(캡처 노이즈/글로우) 굴린 5가 가끔 3으로 넘어갔다(약 3초에 1회). 5의 판별 점이
// 모서리라 중심 오차에 취약(3은 중앙이라 강인 → 5만 발생). 분류 시 중심을 국소 정밀화
// (±REFINE에서 best-template SSD 최소 위치 선택)해 중심 지터에 강인하게 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadPng } from './png.mjs';
import { toGray } from '../../src/vision/image.js';
import { findDieBlob } from '../../src/vision/blob.js';
import { classifyByTemplate } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const F16 = join(FIX, '16-real-1920-five.png');
const skip = !existsSync(F16) && 'vision-fixtures 없음(로컬 전용)';

test('굴린 5: 중심이 ±몇px 흔들려도 5로 인식(라이브 지터 강인)', { skip }, () => {
  const gray = toGray(loadPng(F16));
  const cs = 60, holdHalf = Math.round(cs * 0.875);
  const blobOpts = { minPx: Math.round(cs*cs*0.39), min: Math.round(cs*0.6875), max: Math.round(cs*1.375) };
  const b = findDieBlob(gray, 530, 627, holdHalf, blobOpts);
  const srcSize = Math.round(Math.round((b.w + b.h) / 2) * 0.875);
  // 정확 중심은 5(견고)
  assert.equal(classifyByTemplate(gray, b.cx, b.cy, srcSize).value, 5, '정중심 5');
  // 라이브 지터 시뮬: 중심 오프셋 몇 개(정밀화 전엔 3/2/1로 오분류되던 지점들)
  for (const [dx, dy] of [[4, 0], [4, -2], [4, 2], [0, 4], [-4, 4], [4, 4]]) {
    assert.equal(classifyByTemplate(gray, b.cx + dx, b.cy + dy, srcSize).value, 5, `지터(+${dx},${dy})에도 5`);
  }
});
