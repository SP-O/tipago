// src/vision/recognize.js
// Pipeline: anchor → layout → classify cells → turn / bonusMode / clipped
// Imports: image.js, anchor.js, landmark-data.js, layout.js, templates-data.js, blob.js

import { toGray, normPatchScaled } from './image.js';
import { findAnchor } from './anchor.js';
import { LANDMARK } from './landmark-data.js';
import { anchorToBoardRect, computeLayout } from './layout.js';
import { TEMPLATES, TPL_SIZE } from './templates-data.js';
import { findDieBlob } from './blob.js';

// ---- colour helpers (use raw RGBA frame) --------------------------------

function isRed(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
  return r - g > 40 && r - b > 40 && r > 110;
}

function isGreen(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
  return g - r > 25 && g - b > 25 && g > 90;
}

// ---- shield detection ---------------------------------------------------
// Sample border ring at ~cellSize*0.5 and cellSize*0.55 from the centre (40-44px at cellSize=80)

function isShield(frame, cx, cy, cellSize) {
  function ratioAt(r) {
    let edge = 0, total = 0;
    for (let x = cx - r; x <= cx + r; x += 2) {
      if (x < 0 || x >= frame.width) continue;
      if (cy - r >= 0 && cy - r < frame.height) { total++; if (isRed(frame, x, cy - r) || isGreen(frame, x, cy - r)) edge++; }
      if (cy + r >= 0 && cy + r < frame.height) { total++; if (isRed(frame, x, cy + r) || isGreen(frame, x, cy + r)) edge++; }
    }
    for (let y = cy - r; y <= cy + r; y += 2) {
      if (y < 0 || y >= frame.height) continue;
      if (cx - r >= 0 && cx - r < frame.width) { total++; if (isRed(frame, cx - r, y) || isGreen(frame, cx - r, y)) edge++; }
      if (cx + r >= 0 && cx + r < frame.width) { total++; if (isRed(frame, cx + r, y) || isGreen(frame, cx + r, y)) edge++; }
    }
    return total > 0 ? edge / total : 0;
  }
  const r1 = Math.round(cellSize * 0.5), r2 = Math.round(cellSize * 0.55), r3 = Math.round(cellSize * 0.6);
  return Math.max(ratioAt(r1), ratioAt(r2), ratioAt(r3)) > 0.2;
}

// ---- SSD between two Float32Arrays -------------------------------------

function ssd(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

// ---- cell classification (template matching 1..6) ----------------------

// 템플릿은 기준 배율(cellSize≈80)에서 창 70px로 박제됨. 다른 해상도에선 실제 다이 크기에 맞춰
// srcSize 창을 잡아 TPL_SIZE로 리샘플 → 스케일 무관 매칭. srcSize = cs * (70/80).
const BASELINE_CELL = 80;
function srcWinFor(cs) { return Math.max(8, Math.round(cs * TPL_SIZE / BASELINE_CELL)); }

function classifyByTemplate(gray, cx, cy, srcSize) {
  const p = normPatchScaled(gray, cx, cy, srcSize, TPL_SIZE);
  let bestVal = -1, bestScore = Infinity, secondScore = Infinity;
  for (let k = 1; k <= 6; k++) {
    if (!TEMPLATES[k]) continue;
    const s = ssd(p, TEMPLATES[k]);
    if (s < bestScore) { secondScore = bestScore; bestScore = s; bestVal = k; }
    else if (s < secondScore) { secondScore = s; }
  }
  const conf = bestScore > 0 ? (secondScore - bestScore) / bestScore : Infinity;
  return { value: bestVal, conf };
}

// ---- clipped detection --------------------------------------------------
// A cell is considered clipped if its centre + a full cellSize extends outside the frame.
// (Generous check: catches cases where the game window is scrolled partially off-screen.)

function isCellClipped(cx, cy, cellSize, width, height) {
  return (
    cx - cellSize < 0 ||
    cy - cellSize < 0 ||
    cx + cellSize > width ||
    cy + cellSize > height
  );
}

// Check if a sampling window (center ± half) is completely within frame bounds
function inFrameWindow(cx, cy, half, w, h) {
  return cx - half >= 0 && cy - half >= 0 && cx + half < w && cy + half < h;
}

// ---- main export -------------------------------------------------------

/**
 * Recognize board state from a raw RGBA frame.
 * @param {{ width:number, height:number, data:Uint8Array }} frame
 * @param {{ x:number, y:number, w:number, h:number }|null} boardRect
 * @returns {{ cells:{me:Array, opp:Array}, rolledDie:number, isMyTurn:boolean, bonusMode:boolean, clipped:boolean }}
 */
export function recognizeFrame(frame, boardRect = null) {
  const gray = toGray(frame);
  const rect = boardRect || anchorToBoardRect(findAnchor(gray, LANDMARK));
  const L = computeLayout(rect);
  const cs = L.cellSize;
  // 모든 픽셀 파라미터를 cellSize(=보정 박스에 비례)로 스케일 → 해상도 무관.
  // 기준 배율 cs≈80에서 아래 값들은 기존 상수(48/55/110/2500/70)와 동일 → 하위호환.
  const srcSize = srcWinFor(cs);
  const cellHalf = Math.round(cs * 0.6);
  const blobOpts = { minPx: Math.round(cs * cs * 0.39), min: Math.round(cs * 0.6875), max: Math.round(cs * 1.375) };

  let clipped = false;

  // Process one side (me or opp), return 3×3 array of cells
  function processSide(sideCells) {
    return sideCells.map(row =>
      row.map(({ cx, cy }) => {
        if (isCellClipped(cx, cy, cs, gray.width, gray.height)) { clipped = true; return null; }
        const b = findDieBlob(gray, cx, cy, cellHalf, blobOpts);
        if (!b) return { value: 0, shield: false, conf: Infinity }; // 빈칸
        const { value, conf } = classifyByTemplate(gray, b.cx, b.cy, srcSize);
        const shield = isShield(frame, b.cx, b.cy, cs);
        return { value, shield, conf };
      })
    );
  }

  const meCells = processSide(L.cells.me);
  const oppCells = processSide(L.cells.opp);

  // Turn detection via holding blob detection (clip-guarded: out-of-frame → not my turn)
  const holdHalf = Math.round(cs * 0.875);
  let isMyTurn = false, rolledDie = 0, rolledShield = false;
  if (inFrameWindow(L.holdMine.cx, L.holdMine.cy, holdHalf, gray.width, gray.height)) {
    const hb = findDieBlob(gray, L.holdMine.cx, L.holdMine.cy, holdHalf, blobOpts);
    if (hb) { isMyTurn = true; rolledDie = classifyByTemplate(gray, hb.cx, hb.cy, srcSize).value; rolledShield = isShield(frame, hb.cx, hb.cy, cs); }
  }

  // 보너스 주사위: 굴린 주사위가 쉴드 + 내 필드에 이미 주사위 있음(첫턴 제외 — 상대필드 배치 불가)
  const myHasDice = meCells.some((row) => row.some((c) => c && c.value > 0));
  const bonusMode = rolledShield && myHasDice;

  return {
    cells: { me: meCells, opp: oppCells },
    rolledDie,
    isMyTurn,
    rolledShield,
    bonusMode,
    clipped,
  };
}
