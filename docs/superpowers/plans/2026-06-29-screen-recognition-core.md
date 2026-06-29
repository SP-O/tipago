# 화면 인식 — 인식 코어(순수 모듈) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스크린샷 1프레임을 입력하면 티카투카 보드 상태(내/상대 라인 packed 배열, 굴린 주사위, 내 턴, 보너스모드, 잘림, 신뢰도)를 내놓는 **순수 인식 파이프라인**을 만든다. (라이브 캡처·UI는 Plan 2)

**Architecture:** 모든 모듈은 순수함수이며 `frame = {data:Uint8ClampedArray RGBA, width, height}`만 입력받는다. 파이프라인: `anchor(상단 로고 매칭 → {x,y,scale}, Tier 1)` → `anchorToBoardRect → boardRect` → `layout(boardRect 내부 비율 → 18칸 사각형)` → `recognize(칸 템플릿 매칭 + 실드 + 홀딩박스 → 공간 칸)` → `adapter(공간 3칸 → packed 라인, 내 필드 우→좌)`. **layout이 boardRect를 입력받는 이유**: Tier 2(박스 드래그 보정, Plan 2)도 같은 boardRect를 주므로 해상도 무관하게 동일 격자 로직 사용. 테스트는 `vision-fixtures/*.png`(01·02·04·05·07·08·09)를 무의존성 zlib 디코더로 읽어 결정적으로 검증.

**Tech Stack:** 순수 ES 모듈(브라우저+Node 공용), Node `node --test`, 무의존성(PNG 디코드는 Node 내장 `zlib`, 브라우저는 canvas). 스파이크에서 검증된 코드를 승격.

## Global Constraints

- **런타임 의존성 0** — npm 패키지 추가 금지. Node 테스트만 `node:`/내장 모듈 사용. 브라우저는 canvas. (CLAUDE.md)
- **순수 모듈은 브라우저 전역(`window`,`document`,`navigator`) 접근 금지** — 그래야 Node 테스트에서 import 가능. 브라우저 결합부는 Plan 2의 `capture.js`에만.
- **frame 인터페이스 고정**: `{ data: Uint8ClampedArray (RGBA, 길이 = w*h*4), width, height }`. Node/브라우저 동일.
- **화면칸 ↔ packed 인덱스 매핑은 `src/ui-layout.js` 규칙과 일치**: 내 필드 우→좌(첫 주사위=cell2), 상대 좌→우(첫 주사위=cell0). (CLAUDE.md)
- **엔진엔 값+실드(boolean)+필드위치만 필요** — 점/테두리 색(소유)은 무시.
- 테스트 파일은 `tests/vision/`. 실행: `node --test`. 픽스처는 `vision-fixtures/`(커밋 안 함, 로컬). 커밋 메시지는 ASCII-safe(화살표·따옴표 금지).

---

### Task 1: PNG 디코드 테스트 헬퍼

스파이크에서 검증된 무의존성 PNG 디코더를 테스트 헬퍼로 승격. 브라우저는 안 씀(canvas 사용) → `tests/` 아래에 둔다.

**Files:**
- Create: `tests/vision/png.mjs`
- Test: `tests/vision/png.test.js`

**Interfaces:**
- Produces: `loadPng(absPath) -> { data: Uint8Array(RGBA), width, height }` ; `decodePng(buffer) -> 동일`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/vision/png.test.js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/png.test.js`
Expected: FAIL — `Cannot find module './png.mjs'`

- [ ] **Step 3: 디코더 구현** (스파이크 검증본 승격)

`tests/vision/png.mjs` 에 8-bit RGBA/RGB·non-interlaced PNG 디코더 작성: PNG 시그니처 검사 → IHDR(width,height,bitDepth,colorType) → IDAT 수집 → `zlib.inflateSync` → 스캔라인 언필터(필터 0~4, Paeth 포함) → RGBA로 정규화. `export function decodePng(buf)` 와 `export function loadPng(path){ return decodePng(readFileSync(path)); }`. (스크래치패드 `png.mjs` 와 동일 로직.)

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/png.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add tests/vision/png.mjs tests/vision/png.test.js
git commit -m "test(vision): 무의존성 PNG 디코드 헬퍼"
```

---

### Task 2: 이미지 유틸 (회색조·크롭·정규화 패치)

**Files:**
- Create: `src/vision/image.js`
- Test: `tests/vision/image.test.js`

**Interfaces:**
- Consumes: frame `{data,width,height}` (Task 1 출력 또는 ImageData)
- Produces:
  - `toGray(frame) -> { g: Uint8Array, width, height }`
  - `cropGray(gray, x, y, w, h) -> { g, width, height }`
  - `normPatch(gray, cx, cy, size) -> Float32Array` (size*size, 제로민)
  - `meanGray(gray, cx, cy, half) -> number`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/vision/image.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGray, cropGray, normPatch, meanGray } from '../../src/vision/image.js';

const frame = { width: 3, height: 2, data: Uint8ClampedArray.from([
  0,0,0,255,  255,255,255,255,  90,90,90,255,
  30,30,30,255, 60,60,60,255,   120,120,120,255]) };

test('toGray: RGBA → 평균 회색조', () => {
  const g = toGray(frame);
  assert.equal(g.width, 3); assert.equal(g.height, 2);
  assert.equal(g.g[0], 0); assert.equal(g.g[1], 255); assert.equal(g.g[2], 90);
});

test('normPatch: 제로민(합 ~0)', () => {
  const g = toGray(frame);
  const p = normPatch(g, 1, 0, 1); // 1x1 → 값 - 자기평균 = 0
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0)) < 1e-6);
});

test('meanGray: 중심 평균', () => {
  const g = toGray(frame);
  assert.equal(meanGray(g, 0, 0, 0), 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/image.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```js
// src/vision/image.js
export function toGray(frame) {
  const { width, height, data } = frame;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  return { g, width, height };
}
export function cropGray(gray, x, y, w, h) {
  const out = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out[yy * w + xx] = gray.g[(y + yy) * gray.width + (x + xx)];
  return { g: out, width: w, height: h };
}
export function normPatch(gray, cx, cy, size) {
  const h = size >> 1, a = new Float32Array(size * size);
  let m = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = gray.g[(cy - h + y) * gray.width + (cx - h + x)]; a[y * size + x] = v; m += v; }
  m /= a.length;
  for (let i = 0; i < a.length; i++) a[i] -= m;
  return a;
}
export function meanGray(gray, cx, cy, half) {
  let s = 0, n = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) { s += gray.g[y * gray.width + x]; n++; }
  return s / n;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/image.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/vision/image.js tests/vision/image.test.js
git commit -m "feat(vision): 이미지 유틸(회색조/크롭/정규화 패치)"
```

---

### Task 3: 앵커 — 다중배율 랜드마크 매칭

상단 로고 패치로 창 위치+배율 검출. 세션당 1회 다중배율(`findAnchor`), 프레임당 위치만(`relocate`).

**Files:**
- Create: `src/vision/anchor.js`
- Create: `src/vision/landmark-data.js` (기준 로고 회색조 패치 — Task 3 Step 3에서 02에서 추출해 base64/배열로 박제)
- Test: `tests/vision/anchor.test.js`

**Interfaces:**
- Consumes: `toGray`,`cropGray` (Task 2)
- Produces:
  - `matchTemplate(frameGray, tmplGray, opts) -> { x, y, score, perPixel }`
  - `findAnchor(frameGray, landmark) -> { x, y, scale, perPixel }` (scale 후보 배열 탐색)
  - `LANDMARK = { g, width, height, refX, refY }` (기준 배율 1에서의 위치)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/vision/anchor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { toGray } from '../../src/vision/image.js';
import { findAnchor } from '../../src/vision/anchor.js';
import { LANDMARK } from '../../src/vision/landmark-data.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const g = (n) => toGray(loadPng(join(FIX, n)));

test('findAnchor: 기준(02) 배율 1, 위치 일치', () => {
  const a = findAnchor(g('02-midgame-shields.png'), LANDMARK);
  assert.ok(Math.abs(a.scale - 1) < 0.06);
  assert.ok(Math.abs(a.x - LANDMARK.refX) < 6 && Math.abs(a.y - LANDMARK.refY) < 6);
  assert.ok(a.perPixel < 10);
});

test('findAnchor: 창 우측 이동(07-after) 추적', () => {
  const a = findAnchor(g('07-alkkagi-after.png'), LANDMARK);
  assert.ok(a.x - LANDMARK.refX > 200); // 우측으로 이동
  assert.ok(a.perPixel < 15);
});

test('findAnchor: 하단 잘림(07-after-3)에도 상단 로고로 검출', () => {
  const a = findAnchor(g('07-alkkagi-after-3.png'), LANDMARK);
  assert.ok(a.y - LANDMARK.refY > 200); // 아래로 이동
  assert.ok(a.perPixel < 30);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/anchor.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 구현 + 랜드마크 박제**

`matchTemplate`/`findAnchor` 는 스크래치패드 `anchor.mjs` 의 coarse-to-fine SAD 를 승격하되, `findAnchor` 는 scale 후보 `[0.5,0.6,...,1.6]` 에 대해 템플릿을 bilinear 리사이즈해 매칭, 최소 perPixel 의 `{x,y,scale,perPixel}` 반환(coarse-to-fine, 상단 밴드 우선 탐색으로 가속).
`landmark-data.js`: 02에서 `cropGray(g02, 1150,90,260,120)` 한 회색조 패치를 1회 추출해 `LANDMARK = { g:[...], width:260, height:120, refX:1150, refY:90 }` 로 박제(생성 스크립트 결과를 파일에 직접 기입). bilinear 리사이즈 헬퍼 포함.

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/anchor.test.js`
Expected: PASS (스파이크에서 이미 동일 수치 확인: 02 perPixel≈0, 07-after dx≈+350, 07-after-3 dy≈+451)

- [ ] **Step 5: 배율 검출 메커니즘 테스트(축소 대리) + 통과**

```js
// 같은 파일에 추가: 02를 0.7배 축소 → 배율 검출 메커니즘이 scale≈0.7 잡는지(대리 검증)
import { resizeGray } from '../../src/vision/anchor.js';
test('findAnchor: 70% 축소본에서 배율 0.7 검출(메커니즘)', () => {
  const f = g('02-midgame-shields.png');
  const low = resizeGray(f, Math.round(f.width * 0.7), Math.round(f.height * 0.7));
  const a = findAnchor(low, LANDMARK);
  assert.ok(Math.abs(a.scale - 0.7) < 0.06);
});
```
Run: `node --test tests/vision/anchor.test.js` → PASS.
> **주의(실측 반영):** 이 축소 테스트는 배율 검출 *메커니즘*만 검증한다. **실제 다른 해상도(09-different-resolution.PNG)** 에서는 게임이 UI를 네이티브로 재래스터해 SAD/NCC 매칭이 실패함이 확인됨 → Tier 1 자동 앵커는 **기준 해상도 전용**, 다른 해상도는 **Tier 2 박스 드래그 보정(Plan 2)** 으로 처리. 따라서 09에는 `findAnchor` 통과 단언을 두지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add src/vision/anchor.js src/vision/landmark-data.js tests/vision/anchor.test.js
git commit -m "feat(vision): Tier1 앵커(이동/잘림/배율검출; 실해상도는 Tier2)"
```

---

### Task 4: 레이아웃 — board rect 기반 비율 격자

**Files:**
- Create: `src/vision/layout.js`
- Test: `tests/vision/layout.test.js`

**Interfaces:**
- Consumes: `findAnchor` 출력 `{x,y,scale}` (Tier 1) — 또는 Tier 2 보정의 boardRect(Plan 2). **layout은 boardRect만 받는다.**
- Produces:
  - `BOARD_REF` (기준 02에서 측정: board rect + 그 안의 18칸·홀딩박스·셀크기 **비율** 상수, 그리고 로고앵커→boardRect 오프셋·크기)
  - `anchorToBoardRect({x,y,scale}) -> { x, y, w, h }` (Tier 1 다리: 로고 앵커 위치+배율 → board rect)
  - `computeLayout(boardRect) -> { cells: { me:[[c,c,c],...3], opp:[[...]] }, holdMine:{cx,cy,w,h}, holdOpp:{...}, cellSize }` ; 각 c = `{cx,cy}` (프레임 절대좌표). **boardRect 내부 비율로 산출** → Tier 1·Tier 2 공용.
  - `inBounds(rect, width, height) -> bool`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/vision/layout.test.js
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
  // 02 내 라인1 3칸은 모두 채워짐(검증: 밝음)
  for (const c of L.cells.me[0]) assert.ok(meanGray(gray, c.cx, c.cy, 12) > 150);
  // 상대 라인1 3번째 칸은 빈칸(어두운 나무)
  assert.ok(meanGray(gray, L.cells.opp[0][2].cx, L.cells.opp[0][2].cy, 12) < 120);
});
```

- [ ] **Step 2: 실패 확인** → FAIL (module not found)
Run: `node --test tests/vision/layout.test.js`

- [ ] **Step 3: 구현 + 비율 상수표 측정**

`BOARD_REF` 을 기준 02(배율1, 앵커 refX=1150,refY=90)에서 측정해 박제:
- 칸 중심(스파이크 측정): 내 x=[920,1049,1179], 상대 x=[1448,1577,1707], 행 y=[603,748,893], 셀크기≈96.
- **board rect 기준**: board rect = 이 칸들을 감싸는 사각형(여유 포함, 예 x:[872,1755], y:[555,941]). 각 칸 중심·홀딩박스·셀크기를 **board rect 내부 비율**(0~1)로 저장.
- **로고앵커→boardRect**: 앵커 refX,refY(1150,90)에서 board rect 좌상단까지 오프셋·크기를 저장 → `anchorToBoardRect({x,y,scale})` = `{ x: x + offX*scale, y: y + offY*scale, w: refW*scale, h: refH*scale }`.
- `computeLayout(boardRect)`: 각 비율 × (boardRect.w/h) + (boardRect.x/y) → 절대 중심. 셀크기 = 비율 × boardRect.w.
- `inBounds`: 사각형이 [0,width)×[0,height) 내인지.
검증 보조: 행 y 는 스파이크에서 ±오차 있었으므로, 측정 후 위 테스트(밝기)로 중심 정합 확인하며 미세조정.

- [ ] **Step 4: 통과 확인** → PASS
Run: `node --test tests/vision/layout.test.js`

- [ ] **Step 5: 이동 픽스처에서도 정합 확인(테스트 추가)**

```js
test('computeLayout: 창 이동(07-after)에도 칸이 주사위에 정합', () => {
  const img = loadPng(join(FIX, '07-alkkagi-after.png'));
  const gray = toGray(img);
  const L = computeLayout(anchorToBoardRect(findAnchor(gray, LANDMARK)));
  let bright = 0;
  for (const line of L.cells.me) for (const c of line) if (meanGray(gray, c.cx, c.cy, 12) > 150) bright++;
  assert.ok(bright >= 4); // 다수 칸이 주사위 위에 정합
});
```
Run → PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/vision/layout.js tests/vision/layout.test.js
git commit -m "feat(vision): 앵커 기준 고정 격자 레이아웃"
```

---

### Task 5: 템플릿 — 면당 평균 패치 박제

**Files:**
- Create: `src/vision/build-templates.mjs` (개발용 생성 스크립트, 1회 실행)
- Create: `src/vision/templates-data.js` (박제된 템플릿: 값 0~6 의 정규화 패치 배열)
- Test: `tests/vision/templates.test.js`

**Interfaces:**
- Produces: `TEMPLATES = { 0:Float32Array, 1:..,..,6:.. }` (각 size*size 제로민), `TPL_SIZE`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/vision/templates.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, TPL_SIZE } from '../../src/vision/templates-data.js';

test('TEMPLATES: 0~6 존재, 각 size*size, 서로 구별됨', () => {
  for (let v = 0; v <= 6; v++) assert.equal(TEMPLATES[v].length, TPL_SIZE * TPL_SIZE);
  const ssd = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  // 씨앗(1)과 2는 충분히 달라야 한다(점세기 실패의 핵심 구분)
  assert.ok(ssd(TEMPLATES[1], TEMPLATES[2]) > ssd(TEMPLATES[2], TEMPLATES[2]) + 1);
});
```

- [ ] **Step 2: 실패 확인** → FAIL
Run: `node --test tests/vision/templates.test.js`

- [ ] **Step 3: 생성 스크립트 작성 후 1회 실행해 박제**

`build-templates.mjs`: 알려진 (값→픽스처·칸) 목록에서 `normPatch(toGray(img), cx, cy, TPL_SIZE)` 추출, 같은 값의 여러 샘플은 평균. `TPL_SIZE=70`. 결과를 `templates-data.js` 에 `export const TPL_SIZE=70; export const TEMPLATES={0:Float32Array.from([...]),...}` 로 기록(스크립트 출력 붙여넣기). 값 출처(최소):
- 0=빈칸: 02 상대 L1c3 / 01 임의 빈칸
- 1=씨앗: 02 내 L2c2
- 2: 02 내 L1c1, 3: 02 내 L1c3, 4: 02 상대 L1c1, 5: 02 상대 L1c2, 6: 06-dice-faces 의 6 칸
좌표는 Task 4 `computeLayout` 로 산출(앵커 기반)해 정확 정합.

- [ ] **Step 4: 통과 확인** → PASS
Run: `node --test tests/vision/templates.test.js`

- [ ] **Step 5: 커밋**

```bash
git add src/vision/build-templates.mjs src/vision/templates-data.js tests/vision/templates.test.js
git commit -m "feat(vision): 주사위 면 템플릿(면당 평균) 박제"
```

---

### Task 6: recognize — 칸 인식(값·실드·턴·잘림·신뢰도)

**Files:**
- Create: `src/vision/recognize.js`
- Test: `tests/vision/recognize.test.js`

**Interfaces:**
- Consumes: `toGray`,`normPatch`,`meanGray`(T2), `findAnchor`(T3), `computeLayout`,`inBounds`(T4), `TEMPLATES`,`TPL_SIZE`(T5), `LANDMARK`
- Produces: `recognizeFrame(frame) -> { cells:{me:[[{value,shield,conf}|null x3]x3], opp:[..]}, rolledDie:0~6, isMyTurn:bool, bonusMode:bool, clipped:bool }`
  - `value`:0~6, `shield`:bool, `conf`:margin. 칸이 프레임 밖이면 `null`.
  - 내부 헬퍼: `classifyCell(gray,cx,cy) -> {value,conf}`, `isShield(frame,cx,cy)->bool`

- [ ] **Step 1: 실패 테스트 작성** (02 보드 기대값 — 스파이크 육안 확정값)

```js
// tests/vision/recognize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const vals = (line) => line.map((c) => (c ? c.value : -1));

test('recognizeFrame(02): 값 정확 + 씨앗=1', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  assert.deepEqual(vals(r.cells.me[1]), [0, 1, 1]);   // 내 L2: 빈,씨앗,씨앗 (점세기는 여기서 2,2로 실패했음)
  assert.deepEqual(vals(r.cells.me[0]), [2, 2, 3]);   // 내 L1
  assert.deepEqual(vals(r.cells.opp[0]), [4, 5, 0]);  // 상대 L1
  assert.equal(r.clipped, false);
  assert.equal(r.isMyTurn, true);                     // 좌측 홀딩박스에 주사위(모든 픽스처가 내 턴)
});

test('recognizeFrame(07-after-3): 하단 잘림 감지', () => {
  const r = recognizeFrame(loadPng(join(FIX, '07-alkkagi-after-3.png')));
  assert.equal(r.clipped, true); // 일부 칸이 프레임 밖
});
```

- [ ] **Step 2: 실패 확인** → FAIL
Run: `node --test tests/vision/recognize.test.js`

- [ ] **Step 3: 구현**

`recognizeFrame`: `gray=toGray(frame)` → `findAnchor` → `computeLayout`. 각 칸: `inBounds` 아니면 `null`+`clipped=true`. 아니면 `meanGray<120` → value 0(빈칸) (또는 빈칸 템플릿 최소). 아니면 `classifyCell`= `normPatch(gray,cx,cy,TPL_SIZE)` 를 `TEMPLATES` 1~6(및 0)과 SSD, 최소값=value, `conf=(2등-1등)/1등`. `isShield`= 칸 테두리 링(±cellSize*0.45)에서 채도 높은 초록/빨강 비율>0.25. 홀딩박스: `meanGray(holdMine)`>임계면 주사위 존재→`isMyTurn=true`, `classifyCell(holdMine 중심)`→`rolledDie`. `bonusMode`: 상대 라인 흰테두리(라인테두리 영역의 흰 픽셀 비율) 감지. 색 판정(isRed/isGreen)은 frame RGBA 사용.

- [ ] **Step 4: 통과 확인** → PASS (스파이크: 02 값 16/18 정확, 씨앗 정확; 행3 미세조정은 Task 4 격자 보정으로 흡수)
Run: `node --test tests/vision/recognize.test.js`

- [ ] **Step 5: 저신뢰 회귀 테스트 추가**

```js
test('recognizeFrame(02): 오답 위험 칸은 conf 낮음(게이팅 근거)', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  const flat = [...r.cells.me, ...r.cells.opp].flat().filter(Boolean);
  assert.ok(flat.every((c) => typeof c.conf === 'number'));
});
```
Run → PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/vision/recognize.js tests/vision/recognize.test.js
git commit -m "feat(vision): recognize - 값/실드/턴/잘림/신뢰도"
```

---

### Task 7: adapter — 공간 3칸 → packed 라인 (정확성 핵심)

**Files:**
- Create: `src/vision/adapter.js`
- Test: `tests/vision/adapter.test.js`

**Interfaces:**
- Consumes: `recognizeFrame` 출력 `cells`
- Produces:
  - `packLine(spatialCells, side) -> { line:[{value,shield}], impossible:bool, minConf:number }` ; side `'me'|'opp'`
  - `toBoardState(recognized) -> { me:[[..]x3], opp:[[..]x3], rolledDie, isMyTurn, bonusMode, clipped, anyLowConf:bool, anyImpossible:bool }`
  - 채움순서: `'me'`는 cell2→1→0, `'opp'`는 cell0→1→2 중 채워진 것(value>0)만.

- [ ] **Step 1: 실패 테스트 작성** (이미지 불필요 — 순수 변환)

```js
// tests/vision/adapter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLine } from '../../src/vision/adapter.js';

const C = (value, shield = false, conf = 9) => ({ value, shield, conf });
const E = { value: 0, shield: false, conf: 9 }; // 빈칸

test('packLine(me): 우→좌 채움 순서', () => {
  // 화면 [빈, 3, 5] (cell0빈,cell1=3,cell2=5) → 내 필드는 cell2 먼저 → [5,3]
  const r = packLine([E, C(3), C(5)], 'me');
  assert.deepEqual(r.line, [{ value: 5, shield: false }, { value: 3, shield: false }]);
  assert.equal(r.impossible, false);
});

test('packLine(opp): 좌→우 채움 순서', () => {
  // 화면 [4,5,빈] → 상대는 cell0 먼저 → [4,5]
  const r = packLine([C(4), C(5), E], 'opp');
  assert.deepEqual(r.line, [{ value: 4, shield: false }, { value: 5, shield: false }]);
});

test('packLine: 불가능한 갭 감지', () => {
  // 내 필드 화면 [채움, 빈, 채움] → 채움-시작(우)부터 연속 아님 → impossible
  const r = packLine([C(2), E, C(6)], 'me');
  assert.equal(r.impossible, true);
});
```

- [ ] **Step 2: 실패 확인** → FAIL
Run: `node --test tests/vision/adapter.test.js`

- [ ] **Step 3: 구현**

```js
// src/vision/adapter.js
export function packLine(spatial, side) {
  // 채움 순서대로 칸 인덱스
  const order = side === 'me' ? [2, 1, 0] : [0, 1, 2];
  const filledFlags = spatial.map((c) => c && c.value > 0);
  const line = [];
  let minConf = Infinity;
  for (const idx of order) {
    const c = spatial[idx];
    if (c && c.value > 0) { line.push({ value: c.value, shield: !!c.shield }); minConf = Math.min(minConf, c.conf); }
  }
  // 불가능한 갭: 채워진 칸이 채움-시작쪽부터 연속이어야 함
  let impossible = false, seenEmpty = false;
  for (const idx of order) { if (filledFlags[idx]) { if (seenEmpty) { impossible = true; break; } } else seenEmpty = true; }
  return { line, impossible, minConf: line.length ? minConf : Infinity };
}
export function toBoardState(rec) {
  const me = rec.cells.me.map((l) => packLine(l, 'me'));
  const opp = rec.cells.opp.map((l) => packLine(l, 'opp'));
  const CONF_MIN = 2; // 초기 임계(스펙 §7), 실측 보정
  return {
    me: me.map((r) => r.line), opp: opp.map((r) => r.line),
    rolledDie: rec.rolledDie, isMyTurn: rec.isMyTurn, bonusMode: rec.bonusMode, clipped: rec.clipped,
    anyImpossible: [...me, ...opp].some((r) => r.impossible),
    anyLowConf: [...me, ...opp].some((r) => r.minConf < CONF_MIN),
  };
}
```

- [ ] **Step 4: 통과 확인** → PASS
Run: `node --test tests/vision/adapter.test.js`

- [ ] **Step 5: 통합 테스트 — 02 프레임 → packed 보드**

```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toBoardState } from '../../src/vision/adapter.js';
import { recognizeFrame } from '../../src/vision/recognize.js';
import { loadPng } from './png.mjs';
const FIX2 = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
test('toBoardState(02): packed 보드 + 잘림없음', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX2, '02-midgame-shields.png'))));
  assert.equal(b.clipped, false);
  assert.equal(b.anyImpossible, false);
  // 내 L2 화면 [빈,씨앗,씨앗] → me 우→좌 packed [1,1]
  assert.deepEqual(b.me[1].map((d) => d.value), [1, 1]);
});
```
Run → PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/vision/adapter.js tests/vision/adapter.test.js
git commit -m "feat(vision): adapter - 공간칸 to packed 라인(채움순서/갭감지)"
```

---

## 전체 회귀 확인

- [ ] **모든 vision 테스트 통과**

Run: `node --test`
Expected: 기존 78 + vision 신규 전부 PASS, fail 0.

## Plan 1 완료 후 산출물
`frame → toBoardState()` 로 **스크린샷 한 장에서 packed 보드 상태**가 나온다. Plan 2(라이브 캡처·워커 루프·UI·자동적용)의 입력 계약이 모두 확정됨.

## Plan 2 예고 (이 플랜 범위 밖, 별도 작성)
- **capture.js** (getDisplayMedia, vision 워커, ImageData transfer) · **scan-controller** (변화감지/디바운스/세션당 배율고정).
- **Tier 1 자동**: `findAnchor`→`anchorToBoardRect`→`computeLayout`. 신뢰도 게이트 실패(앵커 perPixel 높음/`anyImpossible`/`anyLowConf`) → Tier 2 폴백.
- **Tier 2 박스 드래그 보정(사이트 내부)**: 공유 프레임을 canvas 표시 → 마우스 드래그로 boardRect 지정 → `computeLayout(boardRect)` → baked 1차추정 → §11 검토·수정 → **per-user 템플릿 부트스트랩**(수정 칸을 사용자 프레임에서 잘라 저장, 이후 본인 템플릿 매칭) → `localStorage` 해상도별 저장.
- **app.js 통합**: 스캔 버튼/검토 오버레이/§9 자동적용 정책/`pushHistory`/`die`/`bonusMode` 소유권.
- **선행 검증**: 라이브 워커 루프 성능 스파이크(2~4fps, ImageData transfer). (픽스처 게이트 2장은 수집 완료: 08-enemy-turn, 09-different-resolution.)
