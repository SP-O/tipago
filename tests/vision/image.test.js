import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGray, cropGray, normPatch, meanGray } from '../../src/vision/image.js';

const frame = { width: 3, height: 2, data: Uint8ClampedArray.from([
  0,0,0,255,  255,255,255,255,  90,90,90,255,
  30,30,30,255, 60,60,60,255,   120,120,120,255]) };

test('toGray: RGBA → 평균 회색조', () => {
  const g = toGray(frame);
  assert.equal(g.width, 3); assert.equal(g.height, 2);
  assert.equal(g.g[0], 0); assert.equal(g.g[1], 255); assert.equal(g.g[2], 90);
});

test('normPatch: 제로민(합 ~0)', () => {
  const g = toGray(frame);
  const p = normPatch(g, 1, 0, 1); // 1x1 → 값 - 자기평균 = 0
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0)) < 1e-6);
});

test('meanGray: 중심 평균', () => {
  const g = toGray(frame);
  assert.equal(meanGray(g, 0, 0, 0), 0);
});
