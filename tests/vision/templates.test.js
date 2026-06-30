import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, TPL_SIZE } from '../../src/vision/templates-data.js';

test('TEMPLATES: 1~6 존재, 각 size*size', () => {
  assert.equal(TPL_SIZE, 70);
  for (let v = 1; v <= 6; v++) assert.equal(TEMPLATES[v].length, TPL_SIZE * TPL_SIZE);
});
test('TEMPLATES: 면들이 서로 구별됨(1 vs 2)', () => {
  const ssd = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  assert.ok(ssd(TEMPLATES[1], TEMPLATES[2]) > 1);
});
