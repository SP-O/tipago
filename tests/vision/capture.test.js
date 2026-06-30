import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlackFrame } from '../../src/vision/capture.js';

test('isBlackFrame: 검은 프레임 감지', () => {
  const black = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 }; // 전부 0
  assert.equal(isBlackFrame(black), true);
});

test('isBlackFrame: 밝은 프레임은 false', () => {
  const bright = { data: new Uint8ClampedArray(10 * 10 * 4).fill(200), width: 10, height: 10 };
  assert.equal(isBlackFrame(bright), false);
});
