import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { toGray } from '../../src/vision/image.js';
import { findDieBlob } from '../../src/vision/blob.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const gray = toGray(loadPng(join(FIX, '10-live-capture.png')));

test('findDieBlob: 주사위 근처에서 실제 중심 반환', () => {
  // 10-live 굴린주사위(홀딩) 실제 중심 ~ (707,800). 30px 어긋난 곳에서 검색해도 중심 회복.
  const b = findDieBlob(gray, 730, 780, 70);
  assert.ok(b, '블롭 검출');
  assert.ok(Math.abs(b.cx - 707) <= 12 && Math.abs(b.cy - 800) <= 12, `중심 근접: ${JSON.stringify(b)}`);
});

test('findDieBlob: 빈 영역은 null', () => {
  // 보드 우측 빈 상대 홀딩박스 영역(어두움) ~ (1900,800)
  const b = findDieBlob(gray, 1900, 800, 60);
  assert.equal(b, null);
});
