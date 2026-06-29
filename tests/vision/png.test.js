import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');

test('loadPng: 02 픽스처를 RGBA로 디코드', () => {
  const img = loadPng(join(FIX, '02-midgame-shields.png'));
  assert.equal(img.width, 2560);
  assert.equal(img.height, 1440);
  assert.equal(img.data.length, 2560 * 1440 * 4);
  // 로고 영역은 크림색(밝음)
  const i = (150 * 2560 + 1280) * 4;
  assert.ok(img.data[i] > 200 && img.data[i + 1] > 200);
});
