// src/vision/recognize.js
// Pipeline: anchor → layout → classify cells → turn / bonusMode / clipped
// Imports: image.js, anchor.js, landmark-data.js, layout.js, templates-data.js

import { toGray, normPatch, meanGray } from './image.js';
import { findAnchor } from './anchor.js';
import { LANDMARK } from './landmark-data.js';
import { anchorToBoardRect, computeLayout } from './layout.js';
import { TEMPLATES, TPL_SIZE } from './templates-data.js';

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

function isWhite(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
  return r > 200 && g > 200 && b > 200;
}

// ---- shield detection ---------------------------------------------------
// Sample border ring at ~cellSize*0.45 from the centre

function isShield(frame, cx, cy, cellSize) {
  const r = Math.round(cellSize * 0.45);
  let edge = 0, total = 0;
  // top and bottom edges
  for (let x = cx - r; x <= cx + r; x += 2) {
    if (x < 0 || x >= frame.width) continue;
    if (cy - r >= 0 && cy - r < frame.height) { total++; if (isRed(frame, x, cy - r) || isGreen(frame, x, cy - r)) edge++; }
    if (cy + r >= 0 && cy + r < frame.height) { total++; if (isRed(frame, x, cy + r) || isGreen(frame, x, cy + r)) edge++; }
  }
  // left and right edges
  for (let y = cy - r; y <= cy + r; y += 2) {
    if (y < 0 || y >= frame.height) continue;
    if (cx - r >= 0 && cx - r < frame.width) { total++; if (isRed(frame, cx - r, y) || isGreen(frame, cx - r, y)) edge++; }
    if (cx + r >= 0 && cx + r < frame.width) { total++; if (isRed(frame, cx + r, y) || isGreen(frame, cx + r, y)) edge++; }
  }
  return total > 0 && (edge / total) > 0.25;
}

// ---- SSD between two Float32Arrays -------------------------------------

function ssd(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

// ---- cell classification (template matching 1..6) ----------------------

function classifyByTemplate(gray, cx, cy) {
  const p = normPatch(gray, cx, cy, TPL_SIZE);
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

// Classify a single cell (including empty check)
function classifyCell(gray, cx, cy) {
  const mg = meanGray(gray, cx, cy, 14);
  if (mg < 120) return { value: 0, conf: Infinity };
  return classifyByTemplate(gray, cx, cy);
}

// ---- bonusMode heuristic ------------------------------------------------
// Check if any opponent line has a white-pixel band (high white ratio) around cells

function hasBonusWhiteBand(frame, cells, cellSize) {
  // For each opponent row, sample the surrounding border area
  // If white ratio > threshold in any row, it's bonus mode
  const r = Math.round(cellSize * 0.5);
  for (let row = 0; row < 3; row++) {
    let white = 0, total = 0;
    for (const { cx, cy } of cells[row]) {
      // sample a band around each cell
      for (let x = cx - r; x <= cx + r; x += 3) {
        for (const dy of [-r, r]) {
          const y = cy + dy;
          if (x >= 0 && x < frame.width && y >= 0 && y < frame.height) {
            total++;
            if (isWhite(frame, x, y)) white++;
          }
        }
      }
      for (let y = cy - r; y <= cy + r; y += 3) {
        for (const dx of [-r, r]) {
          const x = cx + dx;
          if (x >= 0 && x < frame.width && y >= 0 && y < frame.height) {
            total++;
            if (isWhite(frame, x, y)) white++;
          }
        }
      }
    }
    if (total > 0 && white / total > 0.3) return true;
  }
  return false;
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
 * @returns {{ cells:{me:Array, opp:Array}, rolledDie:number, isMyTurn:boolean, bonusMode:boolean, clipped:boolean }}
 */
export function recognizeFrame(frame) {
  const gray = toGray(frame);
  const anchor = findAnchor(gray, LANDMARK);
  const boardRect = anchorToBoardRect(anchor);
  const L = computeLayout(boardRect);
  const cs = L.cellSize;

  let clipped = false;

  // Process one side (me or opp), return 3×3 array of cells
  function processSide(sideCells) {
    return sideCells.map(row =>
      row.map(({ cx, cy }) => {
        if (isCellClipped(cx, cy, cs, gray.width, gray.height)) {
          clipped = true;
          return null;
        }
        const { value, conf } = classifyCell(gray, cx, cy);
        const shield = value > 0 ? isShield(frame, cx, cy, cs) : false;
        return { value, shield, conf };
      })
    );
  }

  const meCells = processSide(L.cells.me);
  const oppCells = processSide(L.cells.opp);

  // Turn detection via left holding box brightness (clip-guarded: out-of-frame → not my turn)
  const HOLD_HALF = 14;
  const holdInFrame = inFrameWindow(L.holdMine.cx, L.holdMine.cy, HOLD_HALF, gray.width, gray.height);
  const isMyTurn = holdInFrame && meanGray(gray, L.holdMine.cx, L.holdMine.cy, HOLD_HALF) > 120;
  let rolledDie = 0;
  if (isMyTurn) {
    rolledDie = classifyCell(gray, L.holdMine.cx, L.holdMine.cy).value;
  }

  // bonusMode heuristic: white border band around opponent cells
  const bonusMode = hasBonusWhiteBand(frame, L.cells.opp, cs);

  return {
    cells: { me: meCells, opp: oppCells },
    rolledDie,
    isMyTurn,
    bonusMode,
    clipped,
  };
}
