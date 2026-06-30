import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlesOf, hitTest, applyDrag, toFrameRect, toDisplayRect } from '../../src/vision/calibration.js';

const rect = { x: 100, y: 100, w: 200, h: 100 };

test('handlesOf: 8핸들, 모서리/변 좌표', () => {
  const hs = handlesOf(rect);
  assert.equal(hs.length, 8);
  const by = Object.fromEntries(hs.map(h => [h.id, h]));
  assert.deepEqual([by.nw.x, by.nw.y], [100, 100]);
  assert.deepEqual([by.se.x, by.se.y], [300, 200]);
  assert.deepEqual([by.n.x, by.n.y], [200, 100]);
});

test('hitTest: 핸들/내부/바깥', () => {
  assert.equal(hitTest({ x: 100, y: 100 }, rect, 10), 'nw');
  assert.equal(hitTest({ x: 200, y: 150 }, rect, 10), 'inside');
  assert.equal(hitTest({ x: 5, y: 5 }, rect, 10), null);
});

test('applyDrag: 이동', () => {
  assert.deepEqual(applyDrag(rect, 'inside', 10, -5), { x: 110, y: 95, w: 200, h: 100 });
});

test('applyDrag: se 리사이즈', () => {
  assert.deepEqual(applyDrag(rect, 'se', 20, 10), { x: 100, y: 100, w: 220, h: 110 });
});

test('applyDrag: nw 리사이즈(원점·크기 동시)', () => {
  assert.deepEqual(applyDrag(rect, 'nw', 10, 10), { x: 110, y: 110, w: 190, h: 90 });
});

test('applyDrag: 최소크기 클램프', () => {
  const r = applyDrag(rect, 'se', -1000, -1000);
  assert.ok(r.w >= 40 && r.h >= 40);
});

test('toFrameRect/toDisplayRect: 왕복', () => {
  const disp = toDisplayRect(rect, 0.5); // 표시 = 프레임*0.5
  assert.deepEqual(disp, { x: 50, y: 50, w: 100, h: 50 });
  assert.deepEqual(toFrameRect(disp, 0.5), rect);
});
