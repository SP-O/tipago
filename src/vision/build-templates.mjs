// build-templates.mjs — 개발용 생성 스크립트. Node.js 전용.
// 픽스처에서 주사위 면 템플릿(회색조 정규화 70x70)을 추출해 templates-data.js로 출력.
// 실행: node src/vision/build-templates.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadPng } from '../../tests/vision/png.mjs';
import { toGray, normPatch } from './image.js';
import { findAnchor } from './anchor.js';
import { LANDMARK } from './landmark-data.js';
import { computeLayout, anchorToBoardRect } from './layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, '../../vision-fixtures');
const OUT = join(__dirname, 'templates-data.js');

const TPL_SIZE = 70;

// 패치 추출 헬퍼
function extractPatch(gray, cx, cy) {
  return normPatch(gray, cx, cy, TPL_SIZE);
}

// 복수 패치 원소별 평균
function avgPatches(patches) {
  const n = patches.length;
  const len = patches[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const p of patches) s += p[i];
    out[i] = s / n;
  }
  return out;
}

// ─── 02-midgame-shields.png 에서 0~5 추출 ───────────────────────────────────
// 02 보드: 내 L1[2,2,3] L2[빈,1,1] L3[5,4,1] / 상대 L1[4,5,빈] L2[4,4,빈] L3[5,1,4]
// cells.me[row][col], cells.opp[row][col] (0-indexed)
const img02 = loadPng(join(FIX, '02-midgame-shields.png'));
const gray02 = toGray(img02);
const anchor02 = findAnchor(gray02, LANDMARK);
const layout02 = computeLayout(anchorToBoardRect(anchor02));
const me02 = layout02.cells.me;   // [row][col]
const opp02 = layout02.cells.opp; // [row][col]

console.log(`02 anchor: x=${anchor02.x} y=${anchor02.y} scale=${anchor02.scale} perPixel=${anchor02.perPixel.toFixed(2)}`);
console.log(`02 me[0]: ${me02[0].map(c => `(${c.cx},${c.cy})`).join(' ')}`);
console.log(`02 opp[0]: ${opp02[0].map(c => `(${c.cx},${c.cy})`).join(' ')}`);

// 0 (빈칸): opp[0][2]
const t0 = avgPatches([extractPatch(gray02, opp02[0][2].cx, opp02[0][2].cy)]);

// 1 (씨앗): me[1][1]
const t1 = avgPatches([extractPatch(gray02, me02[1][1].cx, me02[1][1].cy)]);

// 2: me[0][0], me[0][1]
const t2 = avgPatches([
  extractPatch(gray02, me02[0][0].cx, me02[0][0].cy),
  extractPatch(gray02, me02[0][1].cx, me02[0][1].cy),
]);

// 3: me[0][2]
const t3 = avgPatches([extractPatch(gray02, me02[0][2].cx, me02[0][2].cy)]);

// 4: opp[0][0], opp[1][0], opp[1][1]
const t4 = avgPatches([
  extractPatch(gray02, opp02[0][0].cx, opp02[0][0].cy),
  extractPatch(gray02, opp02[1][0].cx, opp02[1][0].cy),
  extractPatch(gray02, opp02[1][1].cx, opp02[1][1].cy),
]);

// 5: opp[0][1], me[2][0]
const t5 = avgPatches([
  extractPatch(gray02, opp02[0][1].cx, opp02[0][1].cy),
  extractPatch(gray02, me02[2][0].cx, me02[2][0].cy),
]);

// ─── 06-dice-faces.png 에서 6 추출 ──────────────────────────────────────────
// 색 pip 판정: 빨강 r-g>40 && r-b>40 && r>110 / 초록 g-r>25 && g-b>25 && g>90
// 4-연결 성분 개수, 최소 크기 10px 이상 → 6개인 칸을 찾는다

const img06 = loadPng(join(FIX, '06-dice-faces.png'));
const gray06 = toGray(img06);
const anchor06 = findAnchor(gray06, LANDMARK);
const layout06 = computeLayout(anchorToBoardRect(anchor06));

console.log(`06 anchor: x=${anchor06.x} y=${anchor06.y} scale=${anchor06.scale} perPixel=${anchor06.perPixel.toFixed(2)}`);

// pip 판정 함수 (원본 RGBA 이미지에서 직접 검사)
function isPip(imgData, x, y, width) {
  const i = (y * width + x) * 4;
  const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
  return (r - g > 40 && r - b > 40 && r > 110) ||  // 빨강
         (g - r > 25 && g - b > 25 && g > 90);      // 초록
}

// 4-연결 플러드 필 (BFS)
function floodFill(mask, x0, y0, width, height, visited) {
  const q = [[x0, y0]];
  const pts = [];
  visited[y0 * width + x0] = true;
  while (q.length > 0) {
    const [cx, cy] = q.shift();
    pts.push([cx, cy]);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const idx = ny * width + nx;
      if (visited[idx] || !mask[idx]) continue;
      visited[idx] = true;
      q.push([nx, ny]);
    }
  }
  return pts;
}

// 셀 영역 내 pip 성분 수 세기
function countPips(img, cx, cy, halfSize) {
  const { data, width, height } = img;
  const x0 = Math.max(0, cx - halfSize), y0 = Math.max(0, cy - halfSize);
  const x1 = Math.min(width - 1, cx + halfSize), y1 = Math.min(height - 1, cy + halfSize);
  const W = x1 - x0 + 1, H = y1 - y0 + 1;

  // pip 마스크 생성
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      mask[y * W + x] = isPip(data, x0 + x, y0 + y, width) ? 1 : 0;
    }
  }

  // 4-연결 성분 라벨링
  const visited = new Uint8Array(W * H);
  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (mask[idx] && !visited[idx]) {
        const component = floodFill(mask, x, y, W, H, visited);
        if (component.length >= 10) count++;  // 최소 10px
      }
    }
  }
  return count;
}

// 모든 18칸을 검사해서 pip 6개인 칸 찾기
const { me: me06, opp: opp06 } = layout06.cells;
const allCells06 = [];
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    allCells06.push({ row, col, side: 'me', ...me06[row][col] });
    allCells06.push({ row, col, side: 'opp', ...opp06[row][col] });
  }
}

const halfCell = Math.round(layout06.cellSize / 2);
console.log(`06 cellSize: ${layout06.cellSize}, halfCell: ${halfCell}`);

let cell6 = null;
for (const c of allCells06) {
  const pips = countPips(img06, c.cx, c.cy, halfCell);
  console.log(`  06 ${c.side}[${c.row}][${c.col}] (${c.cx},${c.cy}) pips=${pips}`);
  if (pips === 6) {
    if (!cell6) cell6 = c;
  }
}

if (!cell6) {
  console.error('ERROR: 6-pip cell not found in 06-dice-faces.png — BLOCKED');
  process.exit(1);
}

// 6-pip cell found at: side=${cell6.side} row=${cell6.row} col=${cell6.col} cx=${cell6.cx} cy=${cell6.cy}
console.log(`6-pip cell: ${cell6.side}[${cell6.row}][${cell6.col}] at (${cell6.cx},${cell6.cy})`);
const t6 = avgPatches([extractPatch(gray06, cell6.cx, cell6.cy)]);

// ─── templates-data.js 출력 ──────────────────────────────────────────────────
const TEMPLATES = { 0: t0, 1: t1, 2: t2, 3: t3, 4: t4, 5: t5, 6: t6 };

// SSD 구별 검증 (1 vs 2)
const ssd12 = t1.reduce((s, x, i) => s + (x - t2[i]) ** 2, 0);
const ssd22 = t2.reduce((s, x, i) => s + (x - t2[i]) ** 2, 0);
console.log(`SSD(1,2)=${ssd12.toFixed(0)} SSD(2,2)=${ssd22} (must be: ${ssd12} > ${ssd22 + 1})`);
if (ssd12 <= ssd22 + 1) {
  console.error('ERROR: TEMPLATES[1] and TEMPLATES[2] are not distinguishable — BLOCKED');
  process.exit(1);
}

function tplLine(key, arr) {
  // Float32 values as JSON array
  return `  ${key}: Float32Array.from([${Array.from(arr).join(',')}]),`;
}

const lines = [
  '// 픽스처에서 추출한 주사위 면 템플릿(회색조 정규화 70x70). build-templates.mjs 산출물.',
  '// 6-pip cell 출처: 06-dice-faces.png ' + `${cell6.side}[${cell6.row}][${cell6.col}] at (${cell6.cx},${cell6.cy})`,
  `export const TPL_SIZE = ${TPL_SIZE};`,
  'export const TEMPLATES = {',
  ...Object.entries(TEMPLATES).map(([k, v]) => tplLine(k, v)),
  '};',
];

writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log(`Written: ${OUT}`);
