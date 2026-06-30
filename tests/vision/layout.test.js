import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { toGray, meanGray } from '../../src/vision/image.js';
import { findAnchor } from '../../src/vision/anchor.js';
import { LANDMARK } from '../../src/vision/landmark-data.js';
import { computeLayout, anchorToBoardRect } from '../../src/vision/layout.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');

test('computeLayout: 채워진 칸 중심은 밝은 주사위(중심밝기>150)', () => {
  const img = loadPng(join(FIX, '02-midgame-shields.png'));
  const gray = toGray(img);
  const L = computeLayout(anchorToBoardRect(findAnchor(gray, LANDMARK)));
  for (const c of L.cells.me[0]) assert.ok(meanGray(gray, c.cx, c.cy, 12) > 150);
  assert.ok(meanGray(gray, L.cells.opp[0][2].cx, L.cells.opp[0][2].cy, 12) < 120);
});

test('computeLayout: 창 이동(07-after)에도 칸이 주사위에 정합', () => {
  const img = loadPng(join(FIX, '07-alkkagi-after.png'));
  const gray = toGray(img);
  const L = computeLayout(anchorToBoardRect(findAnchor(gray, LANDMARK)));
  let bright = 0;
  for (const line of L.cells.me) for (const c of line) if (meanGray(gray, c.cx, c.cy, 12) > 150) bright++;
  assert.ok(bright >= 4);
});
