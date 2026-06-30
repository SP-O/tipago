import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, TPL_SIZE } from '../../src/vision/templates-data.js';

test('TEMPLATES: 0~6 존재, 각 size*size, 서로 구별됨', () => {
  for (let v = 0; v <= 6; v++) assert.equal(TEMPLATES[v].length, TPL_SIZE * TPL_SIZE);
  const ssd = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  // 씨앗(1)과 2는 충분히 달라야 한다(점세기 실패의 핵심 구분)
  assert.ok(ssd(TEMPLATES[1], TEMPLATES[2]) > ssd(TEMPLATES[2], TEMPLATES[2]) + 1);
});
