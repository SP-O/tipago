# Tier2 보정 + 블롭검출 + 템플릿 재제작 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 화면공유 캡처에서 보드를 정확히(~96%) 인식하도록, 사용자 박스 드래그 보정 + 블롭 기반 검출 + 실캡처 재제작 템플릿을 구현하고 기존 스냅샷 스캔 UI에 결선한다.

**Architecture:** Plan 2 파이프라인 재사용. `findAnchor`가 주던 boardRect를 사용자 보정 rect로 대체, `recognize`의 칸/홀딩 분류를 고정점→블롭검출로, 템플릿을 02박제→실캡처 재제작으로 교체. `toBoardState`/`scanGate`/`applyScan`/솔버 불변.

**Tech Stack:** 순수 ES 모듈(브라우저+Node), Vue 3(CDN), Web Worker, `node --test`. 런타임 npm 의존성 0.

**Spec:** [`docs/superpowers/specs/2026-06-30-tier2-calibration-design.md`](../specs/2026-06-30-tier2-calibration-design.md)

## Global Constraints
- **런타임 의존성 0** — npm 금지. `node:` 내장은 테스트/빌드 스크립트만.
- **순수 모듈은 브라우저 전역 금지** — `window`/`document`/`navigator`/`self`는 `capture.js`(함수 본문)·`vision-worker.js`에만. blob/recognize/layout/calibration/adapter/st-writer은 인자(frame/gray/rect)만.
- **frame 계약**: `{ data:Uint8ClampedArray|Uint8Array(RGBA), width, height }`.
- **하위호환**: `recognizeFrame(frame, boardRect=null)` — null이면 기존(앵커) 동작 유지.
- **솔버/엔진/입력 UI/자동적용 정책 불변.** 보드 기록은 `pushHistory()` 경유.
- 커밋 ASCII-safe(한글 OK). 브랜치 `feat/screen-recognition-ui`(현재 브랜치, 미병합) 계속 사용. 작업 디렉토리 리포 루트.
- 픽스처 `vision-fixtures/*.png`는 .gitignore(로컬). 라이브 캡처 `10~14-live.png` 존재.

### 검증된 상수 (여러 태스크 공용)
- 프레임별 boardRect (라이브 5장): `x = mlx-96, y = r1y-72, w=979, h=434`
  - 10: mlx888 r1y654 → {792,582,979,434}; 11: {789,581,..}; 12: {796,554,..}; 13: {794,544,..}; 14: {798,544,..}
- 정답 라벨(공간 좌→우, 0=빈칸):
  - 10: roll6 me[[0,0,4],[0,0,0],[0,0,0]] opp[[0,0,0],[4,0,0],[0,0,0]]
  - 11: roll2 me[[2,4,4],[1,2,2],[0,5,4]] opp[[6,1,1],[3,1,5],[3,6,1]]
  - 12: roll3 me[[3,6,2],[2,5,6],[0,6,6]] opp[[5,5,0],[3,0,0],[2,2,2]]
  - 13: roll1 me[[0,1,2],[5,5,6],[5,2,4]] opp[[2,5,5],[3,0,0],[3,1,0]]
  - 14: roll2 me[[3,2,2],[0,4,2],[6,5,5]] opp[[1,1,4],[4,6,3],[4,4,3]]

---

### Task 1: blob.js — 영역 내 밝은 주사위 블롭 검출 (순수)

**Files:**
- Create: `src/vision/blob.js`
- Test: `tests/vision/blob.test.js`

**Interfaces:**
- Produces: `findDieBlob(gray, cx, cy, half, opts={}) -> {cx,cy}|null` — gray=`{g:Uint8Array, width, height}`(toGray 결과). (cx,cy)±half 영역에서 임계 이상 4-연결 최대 블롭의 bbox 중심. die-크기 아니면/없으면 null.

- [ ] **Step 1: 실패 테스트 작성** — `tests/vision/blob.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/blob.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: 구현** — `src/vision/blob.js`:

```js
// src/vision/blob.js — 영역 내 밝은 주사위 타일(블롭)의 bbox 중심. 순수.
// gray = { g:Uint8Array, width, height } (image.js toGray 결과).
export function findDieBlob(gray, cx, cy, half, opts = {}) {
  const TH = opts.th ?? 165;       // 밝은 타일 임계(회색조)
  const MINPX = opts.minPx ?? 2500; // 최소 픽셀 수
  const MIN = opts.min ?? 55, MAX = opts.max ?? 110; // 타일 변 길이 범위
  const W = gray.width, H = gray.height, g = gray.g;
  const x0 = Math.max(0, cx - half), x1 = Math.min(W, cx + half);
  const y0 = Math.max(0, cy - half), y1 = Math.min(H, cy + half);
  const seen = new Set();
  let best = null;
  const key = (x, y) => y * W + x;
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const k0 = key(sx, sy);
      if (seen.has(k0) || g[k0] < TH) continue;
      let mnx = sx, mxx = sx, mny = sy, mxy = sy, cnt = 0;
      const st = [k0]; seen.add(k0);
      while (st.length) {
        const p = st.pop(), px = p % W, py = (p / W) | 0;
        cnt++;
        if (px < mnx) mnx = px; if (px > mxx) mxx = px;
        if (py < mny) mny = py; if (py > mxy) mxy = py;
        const nbrs = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
        for (const [nx, ny] of nbrs) {
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const kk = key(nx, ny);
          if (seen.has(kk) || g[kk] < TH) continue;
          seen.add(kk); st.push(kk);
        }
      }
      const w = mxx - mnx + 1, h = mxy - mny + 1;
      if (cnt >= MINPX && w >= MIN && w <= MAX && h >= MIN && h <= MAX && (!best || cnt > best.cnt)) {
        best = { cx: Math.round((mnx + mxx) / 2), cy: Math.round((mny + mxy) / 2), cnt };
      }
    }
  }
  return best ? { cx: best.cx, cy: best.cy } : null;
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `node --test`
Expected: blob 2개 PASS, 전체 fail 0.

- [ ] **Step 5: 커밋**

```bash
git add src/vision/blob.js tests/vision/blob.test.js
git commit -m "feat(vision): blob 영역내 주사위 블롭 검출(bbox 중심, 빈영역 null)"
```

---

### Task 2: 템플릿 재제작 — 실캡처 5장 + 정답 라벨

**Files:**
- Modify: `src/vision/build-templates.mjs` (재작성)
- Modify: `src/vision/templates-data.js` (스크립트 산출물 — 교체)
- Modify: `tests/vision/templates.test.js` (유지/갱신)

**Interfaces:**
- Consumes: `findDieBlob`(Task 1), `computeLayout`(layout.js), `normPatch`/`toGray`(image.js), `loadPng`(tests/vision/png.mjs).
- Produces: `templates-data.js`의 `TPL_SIZE=70`, `TEMPLATES={1..6: Float32Array(4900)}` (실캡처 평균; 0은 기존처럼 불필요 — 빈칸은 블롭없음으로 판정하므로 1~6만).

- [ ] **Step 1: build-templates.mjs 재작성** — `src/vision/build-templates.mjs`:

```js
// build-templates.mjs — 실캡처 5장 + 정답 라벨로 주사위 면(1~6) 템플릿 재제작. Node 전용.
// 실행: node src/vision/build-templates.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadPng } from '../../tests/vision/png.mjs';
import { toGray, normPatch } from './image.js';
import { computeLayout } from './layout.js';
import { findDieBlob } from './blob.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '../../vision-fixtures');
const TPL = 70;
const rect = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });

// 라이브 5장: 격자기준 + 정답(공간 좌→우, 0=빈칸) + 굴린주사위
const DATA = [
  { n: '10-live-capture.png', r: rect(888, 654), roll: 6, me: [[0,0,4],[0,0,0],[0,0,0]], opp: [[0,0,0],[4,0,0],[0,0,0]] },
  { n: '11-live.png', r: rect(885, 653), roll: 2, me: [[2,4,4],[1,2,2],[0,5,4]], opp: [[6,1,1],[3,1,5],[3,6,1]] },
  { n: '12-live.png', r: rect(892, 626), roll: 3, me: [[3,6,2],[2,5,6],[0,6,6]], opp: [[5,5,0],[3,0,0],[2,2,2]] },
  { n: '13-live.png', r: rect(890, 616), roll: 1, me: [[0,1,2],[5,5,6],[5,2,4]], opp: [[2,5,5],[3,0,0],[3,1,0]] },
  { n: '14-live.png', r: rect(894, 616), roll: 2, me: [[3,2,2],[0,4,2],[6,5,5]], opp: [[1,1,4],[4,6,3],[4,4,3]] },
];

const sums = {}; // value -> {acc:Float64Array, n}
function add(v, patch) {
  if (!sums[v]) sums[v] = { acc: new Float64Array(TPL * TPL), n: 0 };
  const s = sums[v]; for (let i = 0; i < patch.length; i++) s.acc[i] += patch[i]; s.n++;
}
for (const d of DATA) {
  const gray = toGray(loadPng(join(FIX, d.n)));
  const L = computeLayout(d.r);
  for (const side of ['me', 'opp']) for (let li = 0; li < 3; li++) for (let ci = 0; ci < 3; ci++) {
    const v = d[side][li][ci]; if (!v) continue;
    const c = L.cells[side][li][ci]; const b = findDieBlob(gray, c.cx, c.cy, 48);
    if (b) add(v, normPatch(gray, b.cx, b.cy, TPL));
  }
  const hb = findDieBlob(gray, L.holdMine.cx, L.holdMine.cy, 70);
  if (hb) add(d.roll, normPatch(gray, hb.cx, hb.cy, TPL));
}

let out = '// 실캡처 5장(10~14-live) + 정답으로 재제작한 주사위 면 템플릿(회색조 정규화 70x70).\n';
out += '// build-templates.mjs 산출물. LOO 교차검증 ~95.7%.\n';
out += `export const TPL_SIZE = ${TPL};\nexport const TEMPLATES = {\n`;
for (let v = 1; v <= 6; v++) {
  const s = sums[v]; if (!s) throw new Error(`값 ${v} 샘플 없음`);
  const avg = Array.from(s.acc, (x) => +(x / s.n).toFixed(3));
  out += `  ${v}: Float32Array.from([${avg.join(',')}]),\n`;
}
out += '};\n';
writeFileSync(join(HERE, 'templates-data.js'), out);
console.log('templates-data.js 재생성. 샘플수:', Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.n])));
```

- [ ] **Step 2: 실행 → templates-data.js 생성**

Run: `node src/vision/build-templates.mjs`
Expected: `templates-data.js 재생성. 샘플수: {1:10,2:16,3:10,4:11,5:12,6:10}` (근사).

- [ ] **Step 3: templates.test.js 갱신** — `tests/vision/templates.test.js` 전체를:

```js
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
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/templates.test.js`
Expected: PASS.

> 주의: 이 시점에 기존 `tests/vision/recognize.test.js`(02 기반 값 단언)는 재제작 템플릿+미변경 recognize로 **실패할 수 있다**. Task 4에서 recognize를 블롭검출로 바꾸고 라이브 기반 테스트로 갱신하며 해소한다. 지금은 templates.test.js만 통과시키고 진행.

- [ ] **Step 5: 커밋**

```bash
git add src/vision/build-templates.mjs src/vision/templates-data.js tests/vision/templates.test.js
git commit -m "feat(vision): 템플릿 실캡처 5장 재제작(02 계통오류 해소; 빈칸은 블롭없음 판정)"
```

---

### Task 3: layout.js — 셀크기 80

**Files:**
- Modify: `src/vision/layout.js` (CELL_FRAC 산출 상수)

**Interfaces:**
- Produces: `computeLayout(boardRect).cellSize` ≈ 80 @ w=979 (기존 96에서 변경). cells/holdMine/holdOpp 좌표·BOARD_REF 비율 불변.

- [ ] **Step 1: 변경** — `src/vision/layout.js`의 셀크기 비율 한 줄:

```js
// 변경 전: const CELL_FRAC = 96 / boardRect_ref.w;
const CELL_FRAC = 80 / boardRect_ref.w; // 실측: 라이브 주사위 타일 ~80px
```

(주석 `// 행 y: [603, 748, 893]  셀크기: 96` 도 `셀크기: 80(실측)` 로 갱신.)

- [ ] **Step 2: 회귀 확인** — 기존 layout.test.js(02 밝기 정합)는 셀크기와 무관(중심 좌표 사용)하므로 통과해야 함.

Run: `node --test tests/vision/layout.test.js`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add src/vision/layout.js
git commit -m "feat(vision): layout 셀크기 80(실측) - 실드 링/클립 판정 정확화"
```

---

### Task 4: recognize.js — boardRect 인자 + 블롭검출 분류 + 라이브 정확도

**Files:**
- Modify: `src/vision/recognize.js`
- Modify: `tests/vision/recognize.test.js` (라이브 기반으로 갱신)

**Interfaces:**
- Consumes: `findDieBlob`(Task1), 재제작 `TEMPLATES`(Task2).
- Produces: `recognizeFrame(frame, boardRect=null)` — 반환 형태 불변(`{cells:{me,opp}, rolledDie, isMyTurn, bonusMode, clipped}`), 단 분류가 블롭검출 기반.

- [ ] **Step 1: recognize.js 수정**

(a) import에 blob 추가:
```js
import { findDieBlob } from './blob.js';
```

(b) `recognizeFrame` 시그니처 + 앵커 분기:
```js
export function recognizeFrame(frame, boardRect = null) {
  const gray = toGray(frame);
  const rect = boardRect || anchorToBoardRect(findAnchor(gray, LANDMARK));
  const L = computeLayout(rect);
  const cs = L.cellSize;
  let clipped = false;
  // ... (아래 processSide / 홀딩 교체)
```

(c) `processSide`를 블롭검출 기반으로 교체:
```js
  function processSide(sideCells) {
    return sideCells.map(row =>
      row.map(({ cx, cy }) => {
        if (isCellClipped(cx, cy, cs, gray.width, gray.height)) { clipped = true; return null; }
        const b = findDieBlob(gray, cx, cy, 48);
        if (!b) return { value: 0, shield: false, conf: Infinity }; // 빈칸
        const { value, conf } = classifyByTemplate(gray, b.cx, b.cy);
        const shield = isShield(frame, b.cx, b.cy, cs);
        return { value, shield, conf };
      })
    );
  }
```

(d) 홀딩/턴을 블롭검출 기반으로 교체(기존 inFrameWindow 가드 유지):
```js
  const HOLD_HALF = 70;
  let isMyTurn = false, rolledDie = 0;
  if (inFrameWindow(L.holdMine.cx, L.holdMine.cy, HOLD_HALF, gray.width, gray.height)) {
    const hb = findDieBlob(gray, L.holdMine.cx, L.holdMine.cy, HOLD_HALF);
    if (hb) { isMyTurn = true; rolledDie = classifyByTemplate(gray, hb.cx, hb.cy).value; }
  }
```
> `classifyCell`(중앙밝기 빈칸판정) 및 holding의 옛 meanGray 코드는 제거. `classifyByTemplate`/`isShield`/`isCellClipped`/`inFrameWindow`는 유지.

- [ ] **Step 2: recognize.test.js 갱신** — `tests/vision/recognize.test.js` 전체를:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const R = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });
const FRAMES = [
  { n: '10-live-capture.png', r: R(888,654), roll:6, me:[[0,0,4],[0,0,0],[0,0,0]], opp:[[0,0,0],[4,0,0],[0,0,0]] },
  { n: '11-live.png', r: R(885,653), roll:2, me:[[2,4,4],[1,2,2],[0,5,4]], opp:[[6,1,1],[3,1,5],[3,6,1]] },
  { n: '12-live.png', r: R(892,626), roll:3, me:[[3,6,2],[2,5,6],[0,6,6]], opp:[[5,5,0],[3,0,0],[2,2,2]] },
  { n: '13-live.png', r: R(890,616), roll:1, me:[[0,1,2],[5,5,6],[5,2,4]], opp:[[2,5,5],[3,0,0],[3,1,0]] },
  { n: '14-live.png', r: R(894,616), roll:2, me:[[3,2,2],[0,4,2],[6,5,5]], opp:[[1,1,4],[4,6,3],[4,4,3]] },
];

test('recognizeFrame(boardRect): 라이브 5장 칸 정확도 >= 90%', () => {
  let correct = 0, total = 0;
  for (const f of FRAMES) {
    const r = recognizeFrame(loadPng(join(FIX, f.n)), f.r);
    for (const side of ['me','opp']) for (let li=0; li<3; li++) for (let ci=0; ci<3; ci++) {
      const got = r.cells[side][li][ci] ? r.cells[side][li][ci].value : 0;
      total++; if (got === f[side][li][ci]) correct++;
    }
  }
  const acc = correct / total;
  assert.ok(acc >= 0.90, `정확도 ${(acc*100).toFixed(1)}% (${correct}/${total})`);
});

test('recognizeFrame(10-live): 전칸 정확 + 턴/굴린주사위', () => {
  const f = FRAMES[0];
  const r = recognizeFrame(loadPng(join(FIX, f.n)), f.r);
  assert.equal(r.isMyTurn, true);
  assert.equal(r.rolledDie, 6);
  assert.equal(r.clipped, false);
  const vals = (s,li) => r.cells[s][li].map(c => c ? c.value : 0);
  assert.deepEqual(vals('me',0), [0,0,4]);
  assert.deepEqual(vals('opp',1), [4,0,0]);
});

test('recognizeFrame(null): 앵커 경로 동작 유지(02)', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  assert.equal(typeof r.isMyTurn, 'boolean'); // 앵커 경로가 throw 없이 돈다
});
```

> 02는 비대표라 값 단언은 하지 않고 "앵커 경로가 도는지"만 확인(하위호환 회귀). 라이브 정확도가 진짜 게이트.

- [ ] **Step 3: 실패→통과 확인**

Run: `node --test tests/vision/recognize.test.js`
Expected: 라이브 정확도 테스트 PASS(≥90%, 실측 ~96%), 10-live 전칸 PASS, null 경로 PASS. 만약 정확도 <90%면 Task1 blob `half`(48), Task2 템플릿, rect 상수 점검 — 추측으로 단언 낮추지 말 것.

- [ ] **Step 4: 전체 회귀**

Run: `node --test`
Expected: 전부 PASS, fail 0. (adapter/st-writer/anchor/layout/blob/templates/recognize/png 등.)

- [ ] **Step 5: 커밋**

```bash
git add src/vision/recognize.js tests/vision/recognize.test.js
git commit -m "feat(vision): recognize boardRect 인자 + 블롭검출 분류 - 라이브 5장 ~96%"
```

---

### Task 5: vision-worker.js — boardRect 전달

**Files:**
- Modify: `src/vision/vision-worker.js`

**Interfaces:**
- Consumes: 메시지 `{ buffer, width, height, boardRect? }`.
- Produces: `recognizeFrame(frame, boardRect)` 호출 후 `{ board, ms }`.

- [ ] **Step 1: 수정** — `src/vision/vision-worker.js`의 onmessage:

```js
self.onmessage = (e) => {
  const { buffer, width, height, boardRect } = e.data;
  const frame = { data: new Uint8ClampedArray(buffer), width, height };
  const now = () => (self.performance && self.performance.now ? self.performance.now() : Date.now());
  const t0 = now();
  const board = toBoardState(recognizeFrame(frame, boardRect || null));
  self.postMessage({ board, ms: now() - t0 });
};
```

- [ ] **Step 2: 구문 점검 + 회귀**

Run: `node --check src/vision/vision-worker.js && node --test`
Expected: 구문 OK, 전체 fail 0(워커는 테스트가 import 안 함).

- [ ] **Step 3: 커밋**

```bash
git add src/vision/vision-worker.js
git commit -m "feat(vision): vision-worker boardRect 전달"
```

---

### Task 6: calibration.js — 보정 기하 (순수)

**Files:**
- Create: `src/vision/calibration.js`
- Test: `tests/vision/calibration.test.js`

**Interfaces:**
- Produces:
  - `handlesOf(rect) -> [{id,x,y}]` — id ∈ {nw,n,ne,e,se,s,sw,w}, 8핸들 좌표(프레임 좌표).
  - `hitTest(pt, rect, tol) -> id|'inside'|null` — 핸들 우선, 아니면 rect 내부면 'inside', 밖이면 null.
  - `applyDrag(rect, target, dx, dy) -> rect'` — target='inside'면 이동, 핸들 id면 해당 모서리/변 리사이즈. 최소 w/h 40 클램프.
  - `toFrameRect(dispRect, scale) -> rect` / `toDisplayRect(frameRect, scale) -> rect` — scale=표시폭/프레임폭. frame = disp/scale.

- [ ] **Step 1: 실패 테스트 작성** — `tests/vision/calibration.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/calibration.test.js`
Expected: FAIL(module not found).

- [ ] **Step 3: 구현** — `src/vision/calibration.js`:

```js
// src/vision/calibration.js — 보정 박스 기하(핸들/히트테스트/드래그/좌표환산). 순수, DOM 없음.
const MIN = 40;

export function handlesOf(r) {
  const { x, y, w, h } = r, mx = x + w / 2, my = y + h / 2;
  return [
    { id: 'nw', x, y }, { id: 'n', x: mx, y }, { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: my }, { id: 'se', x: x + w, y: y + h },
    { id: 's', x: mx, y: y + h }, { id: 'sw', x, y: y + h }, { id: 'w', x, y: my },
  ];
}

export function hitTest(pt, r, tol) {
  for (const hnd of handlesOf(r)) {
    if (Math.abs(pt.x - hnd.x) <= tol && Math.abs(pt.y - hnd.y) <= tol) return hnd.id;
  }
  if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return 'inside';
  return null;
}

export function applyDrag(r, target, dx, dy) {
  let { x, y, w, h } = r;
  if (target === 'inside') return { x: x + dx, y: y + dy, w, h };
  const id = target;
  if (id.includes('w')) { x += dx; w -= dx; }
  if (id.includes('e')) { w += dx; }
  if (id.includes('n')) { y += dy; h -= dy; }
  if (id.includes('s')) { h += dy; }
  if (w < MIN) { if (id.includes('w')) x -= (MIN - w); w = MIN; }
  if (h < MIN) { if (id.includes('n')) y -= (MIN - h); h = MIN; }
  return { x, y, w, h };
}

export function toDisplayRect(r, scale) {
  return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}
export function toFrameRect(r, scale) {
  return { x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale };
}
```

- [ ] **Step 4: 통과 + 회귀**

Run: `node --test`
Expected: calibration 7개 PASS, 전체 fail 0.

- [ ] **Step 5: 커밋**

```bash
git add src/vision/calibration.js tests/vision/calibration.test.js
git commit -m "feat(vision): calibration 보정 박스 기하(핸들/히트테스트/드래그/좌표환산)"
```

---

### Task 7: app/index/styles — 보정 패널 + 결선 + UI 정리 (실브라우저 수동)

**Files:**
- Modify: `app.js`, `index.html`, `styles.css`

**Interfaces:**
- Consumes: `calibration.js`(handlesOf/hitTest/applyDrag/toFrameRect/toDisplayRect), `computeLayout`(오버레이 점), `capture.js`, `st-writer.js`, vision-worker.

> 이 태스크는 브라우저 글루(실브라우저 수동 검증). `node --check app.js`로 구문, `node --test`로 회귀(앱은 테스트가 import 안 함)만 자동 확인. 실제 동작은 Step 다수의 수동 체크리스트.

- [ ] **Step 1: app.js — import 추가** (상단 기존 vision import 옆):

```js
import { handlesOf, hitTest, applyDrag, toFrameRect, toDisplayRect } from './src/vision/calibration.js';
import { computeLayout } from './src/vision/layout.js';
```

- [ ] **Step 2: app.js — 보정/스캔 상태 + localStorage** (setup 내 scan 상태 근처):

```js
    const REC_KEY = 'tikatuka.boardRect';
    const cal = reactive({ open: false, rect: null, frame: null, scale: 1, dispW: 0, dispH: 0, dragging: null, last: null });
    function loadSavedRect() { try { return JSON.parse(localStorage.getItem(REC_KEY)); } catch { return null; } }
    let savedRect = loadSavedRect();
```

- [ ] **Step 3: app.js — scanConnect/scanNow를 보정 흐름으로 교체**:

```js
    async function scanConnect() {
      try {
        captureHandle = await captureConnect();
        scan.connected = true;
        const frame = captureGrabFrame(captureHandle);
        if (savedRect && savedRect.capW === frame.width && savedRect.capH === frame.height) {
          scan.status = '연결됨 — [스캔]을 누르세요';
        } else {
          if (savedRect) scan.status = '해상도/창이 달라졌어요 — 보정이 필요합니다';
          openCalibration(frame);
        }
      } catch (err) { scan.status = '화면 연결 취소/실패'; }
    }
    function recalibrate() {
      if (!scan.connected) return;
      try { openCalibration(captureGrabFrame(captureHandle)); }
      catch { scan.status = '프레임 캡처 실패 — 다시 연결'; scan.connected = false; }
    }
    function openCalibration(frame) {
      cal.frame = frame;
      // 시작 추정 rect: 저장값 있으면 그것, 없으면 baked 위치 근처
      cal.rect = savedRect ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
                           : { x: frame.width * 0.31, y: frame.height * 0.40, w: 979, h: 434 };
      cal.open = true;
      // 캔버스 렌더는 Step 6 watcher/그리기 함수가 처리
      renderCalibration();
    }
    function confirmCalibration() {
      savedRect = { ...cal.rect, capW: cal.frame.width, capH: cal.frame.height };
      localStorage.setItem(REC_KEY, JSON.stringify(savedRect));
      cal.open = false; cal.frame = null;
      scan.status = '보정 완료 — [스캔]을 누르세요';
    }
    function cancelCalibration() { cal.open = false; cal.frame = null; }
```

- [ ] **Step 4: app.js — scanNow에 boardRect 전달**:

```js
    function scanNow() {
      if (!scan.connected || scan.busy) return;
      if (!savedRect) { scan.status = '먼저 보정하세요'; recalibrate(); return; }
      let frame;
      try { frame = captureGrabFrame(captureHandle); }
      catch (err) { scan.status = '프레임 캡처 실패 — 다시 연결'; scan.connected = false; return; }
      if (isBlackFrame(frame)) { scan.status = '검은 화면 — 테두리없는 창모드로'; return; }
      scan.busy = true; scan.status = '인식 중...';
      const boardRect = { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h };
      visionWorker.postMessage({ buffer: frame.data.buffer, width: frame.width, height: frame.height, boardRect }, [frame.data.buffer]);
    }
```
(applyScan/scanRowWarn/onmessage는 Plan 2 그대로. 디버그 scanSaveFrame 제거.)

- [ ] **Step 5: app.js — 캔버스 렌더 함수 + 드래그 핸들러** (보정 패널용):

```js
    function renderCalibration() {
      const cv = document.getElementById('calCanvas'); if (!cv || !cal.frame) return;
      const maxW = Math.min(900, window.innerWidth - 80);
      cal.scale = maxW / cal.frame.width;
      cal.dispW = Math.round(cal.frame.width * cal.scale);
      cal.dispH = Math.round(cal.frame.height * cal.scale);
      cv.width = cal.dispW; cv.height = cal.dispH;
      const ctx = cv.getContext('2d');
      // 프레임 그리기(축소)
      const tmp = document.createElement('canvas'); tmp.width = cal.frame.width; tmp.height = cal.frame.height;
      tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cal.frame.data), cal.frame.width, cal.frame.height), 0, 0);
      ctx.drawImage(tmp, 0, 0, cal.dispW, cal.dispH);
      // 오버레이: computeLayout 점 + 박스 + 핸들 (표시 좌표로)
      const L = computeLayout(cal.rect);
      ctx.fillStyle = '#00e0ff';
      const dot = (px, py) => { ctx.beginPath(); ctx.arc(px * cal.scale, py * cal.scale, 4, 0, 7); ctx.fill(); };
      for (const side of ['me', 'opp']) for (const line of L.cells[side]) for (const c of line) dot(c.cx, c.cy);
      ctx.fillStyle = '#ffd000'; dot(L.holdMine.cx, L.holdMine.cy); dot(L.holdOpp.cx, L.holdOpp.cy);
      const d = toDisplayRect(cal.rect, cal.scale);
      ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 2; ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#ffd000'; for (const hnd of handlesOf(d)) { ctx.fillRect(hnd.x - 5, hnd.y - 5, 10, 10); }
    }
    function calPointerDown(ev) {
      const cv = ev.currentTarget, r = cv.getBoundingClientRect();
      const pt = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const d = toDisplayRect(cal.rect, cal.scale);
      cal.dragging = hitTest(pt, d, 9); cal.last = pt;
    }
    function calPointerMove(ev) {
      if (!cal.dragging) return;
      const cv = ev.currentTarget, r = cv.getBoundingClientRect();
      const pt = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const ddx = (pt.x - cal.last.x) / cal.scale, ddy = (pt.y - cal.last.y) / cal.scale;
      cal.rect = applyDrag(cal.rect, cal.dragging, ddx, ddy);
      cal.last = pt; renderCalibration();
    }
    function calPointerUp() { cal.dragging = null; }
```

- [ ] **Step 6: app.js — return에 노출 추가**:

```js
      scan, scanConnect, scanDisconnect, scanNow, scanRowWarn, recalibrate,
      cal, confirmCalibration, cancelCalibration, calPointerDown, calPointerMove, calPointerUp,
```
(기존 `scanSaveFrame`은 제거.)

- [ ] **Step 7: index.html — 툴바 UI 정리** (board-toolbar의 스캔 버튼들 교체):

```html
          <button class="tool-btn" v-if="!scan.connected" @click="scanConnect()">🖥️ 화면 공유</button>
          <button class="tool-btn scan-go" v-if="scan.connected" :disabled="scan.busy" @click="scanNow()">📷 스캔</button>
          <button class="tool-btn" v-if="scan.connected" @click="recalibrate()">📐 재보정</button>
          <button class="tool-btn" v-if="scan.connected" @click="scanDisconnect()">⏹ 공유 중지</button>
          <span class="scan-status" v-if="scan.status">{{ scan.status }}</span>
```

- [ ] **Step 8: index.html — 옵션 접이식** (options-row 교체):

```html
        <div class="options-row">
          <label class="chk"><input type="checkbox" v-model="bonusMode" /> 보너스 주사위(실드·양쪽 배치)</label>
          <details class="opt-more">
            <summary>⚙️ 옵션</summary>
            <label class="chk"><input type="checkbox" v-model="myMitjang" /> 내 밑장빼기 남음</label>
            <label class="chk"><input type="checkbox" v-model="oppMitjang" /> 상대 밑장빼기 사용</label>
            <label class="chk"><input type="checkbox" v-model="precise" /> 정밀 모드(느림·더 최적)</label>
            <label class="chk"><input type="checkbox" v-model="realAI" /> 별 3등급 이하 상대(무지성 알까기)</label>
          </details>
        </div>
```

- [ ] **Step 9: index.html — 보정 패널 모달** (`#app` 안, container 끝 부근에 추가):

```html
      <div class="cal-overlay" v-if="cal.open">
        <div class="cal-modal">
          <div class="cal-help">보드 격자를 주사위/칸에 맞춰 드래그하세요. 파란 점이 칸, 노란 점이 굴림칸입니다.</div>
          <canvas id="calCanvas"
            @pointerdown="calPointerDown" @pointermove="calPointerMove" @pointerup="calPointerUp" @pointerleave="calPointerUp"></canvas>
          <div class="cal-btns">
            <button class="tool-btn" @click="confirmCalibration()">✔ 확인</button>
            <button class="tool-btn" @click="cancelCalibration()">취소</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 10: styles.css — 추가** (파일 끝):

```css
/* 화면 인식 / 보정 */
.scan-status { font-size: 0.85rem; color: var(--muted); margin-left: 0.5rem; }
.tool-btn.scan-go { border-color: var(--gold); }
.vs-row.scan-warn { outline: 2px solid #e6c200; outline-offset: 2px; border-radius: 6px; }
.opt-more { display: inline-block; margin-left: 0.5rem; }
.opt-more summary { cursor: pointer; color: var(--muted); }
.opt-more .chk { display: block; margin-top: 0.4rem; }
.cal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 50; }
.cal-modal { background: var(--panel, #1a1a1a); padding: 16px; border-radius: 10px; max-width: 95vw; }
.cal-modal canvas { display: block; touch-action: none; cursor: crosshair; max-width: 100%; }
.cal-help { color: var(--text); font-size: 0.9rem; margin-bottom: 8px; }
.cal-btns { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
```
(`--muted`/`--gold`/`--panel` 미정의면 styles.css 실제 토큰으로 대체.)

- [ ] **Step 11: 구문 + 회귀**

Run: `node --check app.js && node --test`
Expected: 구문 OK, 전체 fail 0.

- [ ] **Step 12: 실브라우저 수동 검증** (로컬 정적 서버 → Chrome/Edge):
  - [ ] 🖥️ 화면 공유 → 창→로스트아크 선택 → (첫 연결) 보정 패널 자동 오픈.
  - [ ] 보정: 파란 점(칸)·노란 점(굴림칸)을 주사위에 맞게 박스 드래그(이동/모서리 리사이즈) → ✔ 확인.
  - [ ] 📷 스캔(내 턴) → 보드 채워짐 + 굴린주사위 + 자동추천. 상태에 `(NNNms)` → **ms 기록**.
  - [ ] 틀린 칸 있으면 노란 라인 강조 + 클릭 수동수정 → 되돌리기 동작.
  - [ ] 📐 재보정 → 패널 재오픈. ⏹ 공유 중지 → 종료.
  - [ ] 옵션 접이식 펼침/접힘. 기존 기능(숫자패드·실드·밑장빼기·솔브) 정상.

- [ ] **Step 13: 커밋**

```bash
git add app.js index.html styles.css
git commit -m "feat(vision): Tier2 보정 패널 결선 + UI 정리(화면공유 토글/재보정/옵션 접이식)"
```

---

## 빌드 후 마무리
- [ ] 전체 브랜치 리뷰(opus): 무의존성·브라우저안전·기존앱 회귀0·라이브 정확도·frame 계약.
- [ ] `finishing-a-development-branch`: 사용자 승인 후 main 병합 + 배포. 배포 후 실사이트 Step 12 재확인(인식 ms).
- [ ] 메모리/원장 갱신: 측정 ms를 [[screen-recognition-resume]]에 기록(연속 루프 GO/NO-GO).

## Self-Review (작성자 체크)
- **스펙 커버리지:** §0(블롭/재제작/측정)→T1·T2·T3·T4, §2 보정UX→T6·T7, §2.1 UI정리→T7, §3 데이터흐름/저장→T7, §4 모듈표→T1~T7, §5 정확도→T4(≥90%), §6 에러→T7(해상도불일치/검은프레임/저신뢰), §7 테스트→각 T, §8 빌드순서→T1~T7 순서 일치. ✅
- **플레이스홀더:** 없음(모든 코드 단계 실제 코드). ✅
- **타입 일관성:** `findDieBlob`→{cx,cy}|null (T1) 를 T2 빌드·T4 recognize가 동일 사용. boardRect {x,y,w,h} 전 구간 일관. calibration `applyDrag(rect,target,dx,dy)` (T6) ↔ T7 핸들러 사용 일치. `recognizeFrame(frame,boardRect)` (T4) ↔ worker(T5) 일치. ✅
- **범위:** 단일 증분(보정+블롭+재제작+UI). 연속 루프·per-user 부트스트랩 명시적 범위 밖. ✅
