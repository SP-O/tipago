import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { toGray } from '../../src/vision/image.js';
import { findAnchor, resizeGray } from '../../src/vision/anchor.js';
import { LANDMARK } from '../../src/vision/landmark-data.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const g = (n) => toGray(loadPng(join(FIX, n)));

test('findAnchor: 기준(02) 배율 1, 위치 일치', () => {
  const a = findAnchor(g('02-midgame-shields.png'), LANDMARK);
  assert.ok(Math.abs(a.scale - 1) < 0.06);
  assert.ok(Math.abs(a.x - LANDMARK.refX) < 6 && Math.abs(a.y - LANDMARK.refY) < 6);
  assert.ok(a.perPixel < 10);
});

test('findAnchor: 창 우측 이동(07-after) 추적', () => {
  const a = findAnchor(g('07-alkkagi-after.png'), LANDMARK);
  assert.ok(a.x - LANDMARK.refX > 200);
  assert.ok(a.perPixel < 15);
});

test('findAnchor: 하단 잘림(07-after-3)에도 상단 로고로 검출', () => {
  const a = findAnchor(g('07-alkkagi-after-3.png'), LANDMARK);
  assert.ok(a.y - LANDMARK.refY > 200);
  assert.ok(a.perPixel < 30);
});

test('findAnchor: 70% 축소본에서 배율 0.7 검출(메커니즘)', () => {
  const f = g('02-midgame-shields.png');
  const low = resizeGray(f, Math.round(f.width * 0.7), Math.round(f.height * 0.7));
  const a = findAnchor(low, LANDMARK);
  assert.ok(Math.abs(a.scale - 0.7) < 0.06);
});
