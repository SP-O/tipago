# 화면 인식 UI 결선(Plan 2 · 스냅샷 + Tier1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인식 코어(`src/vision/`)를 실제 브라우저 UI에 결선해, "스캔" 버튼 한 번으로 화면공유 프레임에서 보드+굴린 주사위를 읽어 기존 추천 엔진에 자동 입력한다(스냅샷 반자동, Tier1 자동인식, 실패 시 수동 폴백).

**Architecture:** 인식·판정 로직은 순수 모듈(`adapter.js`/`st-writer.js`/이미 검증된 `recognize.js`)에 두고, 브라우저 결합부(`capture.js`)·워커(`vision-worker.js`)·Vue 결선(`app.js`/`index.html`)만 분리한다. 솔버/엔진/기존 입력 UI는 변경하지 않는다. 한 번의 스캔 = `getDisplayMedia` 1프레임 → 비전 워커 → `recognizeFrame`+`toBoardState` → 자동적용 게이트 → `st`/`die`/`solve()`.

**Tech Stack:** 순수 ES 모듈(브라우저+Node), Vue 3 (CDN 전역), Web Worker(`type:module`), `node --test`. 런타임 npm 의존성 0.

**Spec:** [`docs/superpowers/specs/2026-06-30-screen-recognition-ui-design.md`](../specs/2026-06-30-screen-recognition-ui-design.md)

## Global Constraints

- **런타임 의존성 0** — npm 패키지 금지. Node 내장(`node:`)은 테스트/빌드 스크립트에서만.
- **순수 모듈은 브라우저 전역 금지** — `window`/`document`/`navigator`/`self` 접근은 `capture.js`(함수 본문 내)와 `vision-worker.js`에만. 다른 vision 모듈은 인자로 받은 `frame`만 사용.
- **frame 계약 고정**: `{ data: Uint8ClampedArray|Uint8Array (RGBA), width, height }` — Node(zlib)·브라우저(ImageData) 동일.
- **솔버/엔진/기존 입력 UI 불변** — 인식은 추가 입력 경로일 뿐. 모든 보드 기록은 `pushHistory()` 경유(되돌리기 유지).
- **하위호환**: `findAnchor`/`toBoardState` 변경은 기존 인자/필드·동작을 보존(추가만).
- 커밋 메시지 ASCII-safe(한글 OK). 브랜치: `feat/screen-recognition-ui`(main에서 분기). 작업 디렉토리 = 리포 루트.
- 화면칸↔packed 매핑은 `src/ui-layout.js` 규칙과 일치(내 우→좌, 상대 좌→우) — 이미 `adapter.js`가 처리.

---

### Task 1: toBoardState — 라인 단위 플래그 + NaN-안전 저신뢰 (adapter.js)

`toBoardState`에 라인 단위 `lines:{me,opp}`(각 `{lowConf,impossible}`)를 추가하고, `anyLowConf`를 NaN-안전(`!(minConf>=CONF_MIN)`)으로 만든다. 기존 필드·동작 보존.

**Files:**
- Modify: `src/vision/adapter.js` (toBoardState 함수)
- Test: `tests/vision/adapter.test.js` (테스트 추가)

**Interfaces:**
- Consumes: `packLine(spatial, side) -> { line, impossible, minConf }` (기존, 불변).
- Produces: `toBoardState(rec) -> { me, opp, rolledDie, isMyTurn, bonusMode, clipped, anyImpossible, anyLowConf, lines:{ me:[{lowConf:bool,impossible:bool}x3], opp:[...] } }`.

- [ ] **Step 1: 실패 테스트 추가** — `tests/vision/adapter.test.js` 끝에 아래 두 테스트를 추가(기존 import에 `recognizeFrame`, `loadPng`가 이미 있음; 없으면 추가):

```js
test('toBoardState: 라인 단위 lines{me,opp} 제공', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png'))));
  assert.equal(b.lines.me.length, 3);
  assert.equal(b.lines.opp.length, 3);
  for (const l of [...b.lines.me, ...b.lines.opp]) {
    assert.equal(typeof l.lowConf, 'boolean');
    assert.equal(typeof l.impossible, 'boolean');
  }
});

test('toBoardState: NaN conf도 저신뢰로 취급(anyLowConf true)', () => {
  const E = { value: 0, shield: false, conf: Infinity };
  const nanCell = { value: 3, shield: false, conf: NaN };
  const rec = {
    cells: { me: [[E, E, nanCell], [E, E, E], [E, E, E]], opp: [[E, E, E], [E, E, E], [E, E, E]] },
    rolledDie: 0, isMyTurn: false, bonusMode: false, clipped: false,
  };
  assert.equal(toBoardState(rec).anyLowConf, true);
});
```

만약 `recognizeFrame`/`loadPng` import가 파일에 없다면 상단에 추가:
```js
import { recognizeFrame } from '../../src/vision/recognize.js';
import { loadPng } from './png.mjs';
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/adapter.test.js`
Expected: FAIL (`b.lines` undefined → TypeError; NaN 테스트 false).

- [ ] **Step 3: toBoardState 구현 교체** — `src/vision/adapter.js`의 `toBoardState`를 아래로 교체(`packLine`은 그대로):

```js
export function toBoardState(rec) {
  const me = rec.cells.me.map((l) => packLine(l, 'me'));
  const opp = rec.cells.opp.map((l) => packLine(l, 'opp'));
  const CONF_MIN = 2; // 초기 임계(스펙 §7), 실측 보정
  const lowConf = (r) => !(r.minConf >= CONF_MIN); // NaN/Infinity 안전: Infinity>=2=true→false, NaN>=2=false→true
  const info = (rs) => rs.map((r) => ({ lowConf: lowConf(r), impossible: r.impossible }));
  const meInfo = info(me), oppInfo = info(opp);
  return {
    me: me.map((r) => r.line), opp: opp.map((r) => r.line),
    rolledDie: rec.rolledDie, isMyTurn: rec.isMyTurn, bonusMode: rec.bonusMode, clipped: rec.clipped,
    anyImpossible: [...meInfo, ...oppInfo].some((l) => l.impossible),
    anyLowConf: [...meInfo, ...oppInfo].some((l) => l.lowConf),
    lines: { me: meInfo, opp: oppInfo },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/adapter.test.js`
Expected: PASS(기존 4 + 신규 2 = 6).

- [ ] **Step 5: 전체 회귀**

Run: `node --test`
Expected: 전부 PASS, fail 0 (기존 + 신규 2).

- [ ] **Step 6: 커밋**

```bash
git add src/vision/adapter.js tests/vision/adapter.test.js
git commit -m "feat(vision): toBoardState 라인단위 lines 추가 + anyLowConf NaN안전화"
```

---

### Task 2: st-writer — 자동적용 게이트 + reactive 대입형 변환 (순수)

recognize/adapter 결과를 (a) reactive `st`에 그대로 대입할 평면 객체로, (b) 자동적용 가능 여부 게이트로 변환하는 순수 모듈.

**Files:**
- Create: `src/vision/st-writer.js`
- Test: `tests/vision/st-writer.test.js`

**Interfaces:**
- Consumes: `toBoardState(rec)` 출력(Task 1) — `{ me, opp, rolledDie, isMyTurn, bonusMode, clipped, anyImpossible, anyLowConf, lines }`.
- Produces:
  - `boardStateToSt(b) -> { me:[[{value,shield}]x3], opp:[...], die:number, bonusMode:bool }`
  - `scanGate(b) -> { ok:bool, reasons:string[], clipped:bool, isMyTurn:bool, lines:{me,opp} }` (reasons ⊂ `notMyTurn|clipped|impossible|lowConf`).

- [ ] **Step 1: 실패 테스트 작성** — `tests/vision/st-writer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boardStateToSt, scanGate } from '../../src/vision/st-writer.js';
import { recognizeFrame } from '../../src/vision/recognize.js';
import { toBoardState } from '../../src/vision/adapter.js';
import { loadPng } from './png.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const okLine = { lowConf: false, impossible: false };
const good = () => ({
  me: [[{ value: 2, shield: false }], [{ value: 1, shield: false }], []],
  opp: [[{ value: 4, shield: false }], [], []],
  rolledDie: 3, isMyTurn: true, bonusMode: false, clipped: false,
  anyImpossible: false, anyLowConf: false,
  lines: { me: [okLine, okLine, okLine], opp: [okLine, okLine, okLine] },
});

test('boardStateToSt: me/opp/die/bonusMode 매핑', () => {
  const r = boardStateToSt(good());
  assert.deepEqual(r.me, good().me);
  assert.deepEqual(r.opp, good().opp);
  assert.equal(r.die, 3);
  assert.equal(r.bonusMode, false);
});

test('scanGate: 정상 보드 = ok', () => {
  const g = scanGate(good());
  assert.equal(g.ok, true);
  assert.deepEqual(g.reasons, []);
});

test('scanGate: 내 턴 아니면 보류(notMyTurn)', () => {
  const b = good(); b.isMyTurn = false;
  const g = scanGate(b);
  assert.equal(g.ok, false);
  assert.ok(g.reasons.includes('notMyTurn'));
});

test('scanGate: 잘림이면 보류(clipped)', () => {
  const b = good(); b.clipped = true;
  assert.ok(scanGate(b).reasons.includes('clipped'));
});

test('scanGate: 저신뢰면 보류 + 해당 라인 표시', () => {
  const b = good(); b.anyLowConf = true; b.lines.me = [okLine, okLine, { lowConf: true, impossible: false }];
  const g = scanGate(b);
  assert.equal(g.ok, false);
  assert.ok(g.reasons.includes('lowConf'));
  assert.equal(g.lines.me[2].lowConf, true);
});

test('실결과(02): boardStateToSt die=숫자, 내 L2 packed=[1,1]', () => {
  const b = toBoardState(recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png'))));
  const r = boardStateToSt(b);
  assert.deepEqual(r.me[1].map((d) => d.value), [1, 1]);
  assert.equal(typeof r.die, 'number');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/st-writer.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: 구현** — `src/vision/st-writer.js`:

```js
// src/vision/st-writer.js — recognize/adapter 결과 → reactive st 대입형 + 자동적용 게이트. 순수(브라우저 전역 금지).

export function boardStateToSt(b) {
  return { me: b.me, opp: b.opp, die: b.rolledDie, bonusMode: b.bonusMode };
}

export function scanGate(b) {
  const reasons = [];
  if (!b.isMyTurn) reasons.push('notMyTurn');
  if (b.clipped) reasons.push('clipped');
  if (b.anyImpossible) reasons.push('impossible');
  if (b.anyLowConf) reasons.push('lowConf');
  return { ok: reasons.length === 0, reasons, clipped: b.clipped, isMyTurn: b.isMyTurn, lines: b.lines };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/vision/st-writer.test.js`
Expected: PASS(6).

- [ ] **Step 5: 전체 회귀**

Run: `node --test`
Expected: 전부 PASS, fail 0.

- [ ] **Step 6: 커밋**

```bash
git add src/vision/st-writer.js tests/vision/st-writer.test.js
git commit -m "feat(vision): st-writer 자동적용 게이트 + reactive 대입형 변환"
```

---

### Task 3: findAnchor — 선택적 scale 범위 인자 (하위호환)

Tier1 전체화면 가정에서 스케일 탐색 범위를 좁혀 인식 지연을 줄일 수 있도록 `findAnchor`에 옵션 인자를 추가. 기본값은 기존 범위(동작 불변).

**Files:**
- Modify: `src/vision/anchor.js` (findAnchor)
- Test: `tests/vision/anchor.test.js` (테스트 추가)

**Interfaces:**
- Produces: `findAnchor(frameGray, landmark, opts={}) -> {x,y,scale,perPixel}`; `opts.scales?: number[]`(기본 `[0.5..1.6]`).

- [ ] **Step 1: 실패 테스트 추가** — `tests/vision/anchor.test.js`에 추가(상단에 `toGray`,`loadPng`,`LANDMARK`,`findAnchor` import가 이미 있다고 가정; 없으면 기존 테스트 import 재사용):

```js
test('findAnchor: 좁은 scale 범위로도 02 앵커 검출(배율 1)', () => {
  const gray = toGray(loadPng(join(FIX, '02-midgame-shields.png')));
  const a = findAnchor(gray, LANDMARK, { scales: [0.95, 1.0, 1.05] });
  assert.equal(a.scale, 1.0);
  assert.ok(Number.isFinite(a.perPixel));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/anchor.test.js`
Expected: FAIL (opts 무시되면 통과할 수도 있으나, 현재 시그니처는 3번째 인자 미사용 → scale은 여전히 1.0이라 통과 위험. 그렇다면 이 테스트는 *회귀 보호용*이며 Step 3 변경 후에도 PASS 유지가 목표). 우선 실행해 현재 결과를 기록.

> 참고: 이 태스크는 동작을 바꾸지 않고 **옵션을 추가**하는 것이라 테스트가 처음부터 통과할 수 있다. 그럴 경우 Step 3에서 옵션을 실제로 소비하도록 바꾼 뒤 동일 테스트가 계속 통과하는지로 검증한다(좁은 범위가 실제로 적용됨은 Step 4 회귀로 확인).

- [ ] **Step 3: findAnchor 옵션 소비** — `src/vision/anchor.js`의 `findAnchor`를 교체:

```js
export function findAnchor(frameGray, landmark, opts = {}) {
  const scales = opts.scales ?? [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  let best = { x: 0, y: 0, scale: 1, perPixel: Infinity };
  for (const s of scales) {
    const t = resizeGray(landmark, Math.round(landmark.width * s), Math.round(landmark.height * s));
    const m = matchTemplate(frameGray, t, { coarse: 8 });
    if (m.perPixel < best.perPixel) best = { x: m.x, y: m.y, scale: s, perPixel: m.perPixel };
  }
  return best;
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `node --test`
Expected: 전부 PASS, fail 0 (신규 좁은범위 테스트 + 기존 anchor 테스트들 모두). 기존 "기준(02) 배율 1"·"이동 추적"·"하단 잘림"·"70% 축소" 테스트가 기본 범위로 그대로 통과해야 함.

- [ ] **Step 5: 커밋**

```bash
git add src/vision/anchor.js tests/vision/anchor.test.js
git commit -m "feat(vision): findAnchor 선택적 scale 범위 인자(Tier1 속도; 기본 동작 불변)"
```

---

### Task 4: recognize — 홀딩박스 클리핑 가드 (NaN 방지)

`isMyTurn`/`rolledDie` 샘플링 전에 홀딩박스 표본 창이 프레임 안인지 확인. 밖이면 NaN 없이 `isMyTurn=false`로 fail-safe.

**Files:**
- Modify: `src/vision/recognize.js`
- Test: `tests/vision/recognize.test.js` (테스트 추가)

**Interfaces:**
- Produces: `recognizeFrame(frame)` 동작 불변(02 true, 08 false), 단 홀딩박스가 프레임 밖이면 `isMyTurn=false`.

- [ ] **Step 1: 실패 테스트 추가** — `tests/vision/recognize.test.js`에 추가:

```js
test('recognizeFrame: 작은/이상 프레임에도 isMyTurn=false (NaN 안전)', () => {
  const frame = { data: new Uint8ClampedArray(50 * 50 * 4).fill(100), width: 50, height: 50 };
  const r = recognizeFrame(frame);
  assert.equal(r.isMyTurn, false);
});
```

- [ ] **Step 2: 실패 확인(또는 현행 동작 기록)**

Run: `node --test tests/vision/recognize.test.js`
Expected: 현재도 우연히 통과할 수 있음(meanGray가 NaN→`NaN>120`=false). Step 3에서 **명시적 가드**로 바꿔 의도를 코드화하고, 02/08 회귀가 유지되는지로 검증.

- [ ] **Step 3: 가드 추가** — `src/vision/recognize.js`:

(a) `isCellClipped` 함수 위에 헬퍼 추가:
```js
// 표본 창(중심±half)이 프레임 안에 완전히 들어오는지
function inFrameWindow(cx, cy, half, w, h) {
  return cx - half >= 0 && cy - half >= 0 && cx + half < w && cy + half < h;
}
```

(b) `recognizeFrame` 내 턴 감지 블록(현재 165~170행)을 교체:
```js
  // Turn detection via left holding box brightness (clip-guarded: out-of-frame → not my turn)
  const HOLD_HALF = 14;
  const holdInFrame = inFrameWindow(L.holdMine.cx, L.holdMine.cy, HOLD_HALF, gray.width, gray.height);
  const isMyTurn = holdInFrame && meanGray(gray, L.holdMine.cx, L.holdMine.cy, HOLD_HALF) > 120;
  let rolledDie = 0;
  if (isMyTurn) {
    rolledDie = classifyCell(gray, L.holdMine.cx, L.holdMine.cy).value;
  }
```

- [ ] **Step 4: 통과 + 회귀**

Run: `node --test tests/vision/recognize.test.js`
Expected: PASS — 신규 50x50 테스트 + 기존(02 isMyTurn=true, 08 isMyTurn=false, 07-after-3 clipped=true, conf 숫자) 모두.

- [ ] **Step 5: 전체 회귀 + 커밋**

Run: `node --test` → fail 0.
```bash
git add src/vision/recognize.js tests/vision/recognize.test.js
git commit -m "feat(vision): recognize 홀딩박스 클리핑 가드(프레임 밖이면 내턴 아님, NaN 방지)"
```

---

### Task 5: capture — getDisplayMedia 캡처 + 검은프레임 감지

브라우저 결합부. `connect`/`grabFrame`/`disconnect`는 브라우저 전용(수동 검증), `isBlackFrame`은 순수(단위 테스트).

**Files:**
- Create: `src/vision/capture.js`
- Test: `tests/vision/capture.test.js` (isBlackFrame만)

**Interfaces:**
- Produces:
  - `isBlackFrame(frame, threshold=8) -> bool` (순수)
  - `connect() -> Promise<{stream, video, _canvas?}>` (브라우저)
  - `grabFrame(handle) -> { data:Uint8ClampedArray, width, height }` (브라우저)
  - `disconnect(handle) -> void` (브라우저)

- [ ] **Step 1: 실패 테스트 작성** — `tests/vision/capture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlackFrame } from '../../src/vision/capture.js';

test('isBlackFrame: 검은 프레임 감지', () => {
  const black = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 }; // 전부 0
  assert.equal(isBlackFrame(black), true);
});

test('isBlackFrame: 밝은 프레임은 false', () => {
  const bright = { data: new Uint8ClampedArray(10 * 10 * 4).fill(200), width: 10, height: 10 };
  assert.equal(isBlackFrame(bright), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/vision/capture.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: 구현** — `src/vision/capture.js`:

```js
// src/vision/capture.js — 브라우저 결합부(getDisplayMedia/canvas). isBlackFrame만 순수.
// 모듈 평가 시 브라우저 전역에 접근하지 않음(함수 본문에서만 navigator/document 사용) → Node import 안전.

export function isBlackFrame(frame, threshold = 8) {
  const d = frame.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  const n = frame.width * frame.height;
  return n === 0 ? true : sum / (n * 3) < threshold;
}

export async function connect() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  return { stream, video, _canvas: null };
}

export function grabFrame(handle) {
  const { video } = handle;
  const w = video.videoWidth, h = video.videoHeight;
  if (!handle._canvas) handle._canvas = document.createElement('canvas');
  const canvas = handle._canvas;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

export function disconnect(handle) {
  if (handle && handle.stream) handle.stream.getTracks().forEach((t) => t.stop());
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `node --test`
Expected: capture 2개 PASS, 전체 fail 0.

- [ ] **Step 5: 커밋**

```bash
git add src/vision/capture.js tests/vision/capture.test.js
git commit -m "feat(vision): capture getDisplayMedia 캡처 + 검은프레임 감지(isBlackFrame 순수테스트)"
```

---

### Task 6: vision-worker — 인식 워커

transfer된 프레임을 받아 `recognizeFrame`+`toBoardState` 실행 후 보드+소요 ms 회신. 브라우저 워커 전용(Node import 불가 — `self` 사용). 검증은 Task 7 실브라우저에서.

**Files:**
- Create: `src/vision/vision-worker.js`

**Interfaces:**
- Consumes: 메시지 `{ buffer:ArrayBuffer, width, height }`.
- Produces: 메시지 `{ board: toBoardState결과, ms:number }`.

- [ ] **Step 1: 작성** — `src/vision/vision-worker.js`:

```js
// src/vision/vision-worker.js — Web Worker(type:module). 프레임 인식 → 보드 상태. 솔버 worker.js와 별개.
import { recognizeFrame } from './recognize.js';
import { toBoardState } from './adapter.js';

self.onmessage = (e) => {
  const { buffer, width, height } = e.data;
  const frame = { data: new Uint8ClampedArray(buffer), width, height };
  const now = () => (self.performance && self.performance.now ? self.performance.now() : Date.now());
  const t0 = now();
  const board = toBoardState(recognizeFrame(frame));
  self.postMessage({ board, ms: now() - t0 });
};
```

- [ ] **Step 2: 구문 점검(파싱만, 실행 아님)**

Run: `node --check src/vision/vision-worker.js`
Expected: 출력 없음(구문 OK). *주의*: `node --test`로 import하지 말 것(`self` 미정의로 실패). 동작 검증은 Task 7.

- [ ] **Step 3: 전체 회귀(기존 테스트 불변 확인)**

Run: `node --test`
Expected: fail 0 (이 파일은 어떤 테스트도 import하지 않음).

- [ ] **Step 4: 커밋**

```bash
git add src/vision/vision-worker.js
git commit -m "feat(vision): vision-worker 인식 워커(recognize+toBoardState, ms 측정)"
```

---

### Task 7: app/index 결선 — 스캔 UI + 자동적용 + 라인 강조

`getDisplayMedia` 연결, 스캔 버튼, 워커 호출, 결과를 `st`/`die`/`bonusMode`에 기록(`pushHistory` 경유), 게이트 통과 시 `solve()`, 보류 시 라인 강조 + 정직한 한계 안내. **브라우저 수동 검증**(node 테스트 불가).

**Files:**
- Modify: `app.js` (import 추가, setup 내 스캔 로직, return 노출)
- Modify: `index.html` (툴바에 스캔 버튼·상태, 보드 행에 강조 클래스 바인딩)
- Modify: `styles.css` (`.scan-warn`, `.scan-status` 스타일)

**Interfaces:**
- Consumes: `connect`/`grabFrame`/`disconnect`/`isBlackFrame`(capture.js), `boardStateToSt`/`scanGate`(st-writer.js), `vision-worker.js`.

- [ ] **Step 1: app.js 상단 import 추가** — 기존 import 아래(2행 뒤)에:

```js
import { connect as captureConnect, grabFrame as captureGrabFrame, disconnect as captureDisconnect, isBlackFrame } from './src/vision/capture.js';
import { boardStateToSt, scanGate } from './src/vision/st-writer.js';
```

- [ ] **Step 2: app.js setup 내 스캔 로직 추가** — `solve()` 함수 정의 뒤(약 221행 이후), `return` 직전에:

```js
    // ---- 화면 인식(스냅샷 + Tier1) ----
    const visionWorker = new Worker(new URL('./src/vision/vision-worker.js', import.meta.url), { type: 'module' });
    const scan = reactive({ connected: false, busy: false, status: '', lastMs: null, flags: null });
    let captureHandle = null;

    visionWorker.onmessage = (e) => {
      const { board, ms } = e.data;
      scan.lastMs = Math.round(ms);
      scan.busy = false;
      applyScan(board);
    };

    async function scanConnect() {
      try {
        captureHandle = await captureConnect();
        scan.connected = true;
        scan.status = '연결됨 — 내 턴에 [스캔]을 누르세요';
      } catch (err) {
        scan.status = '화면 연결 취소/실패';
      }
    }
    function scanDisconnect() {
      if (captureHandle) captureDisconnect(captureHandle);
      captureHandle = null;
      scan.connected = false; scan.status = ''; scan.flags = null;
    }
    function scanNow() {
      if (!scan.connected || scan.busy) return;
      let frame;
      try { frame = captureGrabFrame(captureHandle); }
      catch (err) { scan.status = '프레임 캡처 실패 — 다시 연결해 주세요'; scan.connected = false; return; }
      if (isBlackFrame(frame)) { scan.status = '검은 화면 — 전체화면 독점이면 테두리없는 창모드로 바꿔주세요'; return; }
      scan.busy = true; scan.status = '인식 중...';
      visionWorker.postMessage({ buffer: frame.data.buffer, width: frame.width, height: frame.height }, [frame.data.buffer]);
    }
    function applyScan(board) {
      const gate = scanGate(board);
      scan.flags = gate;
      if (!gate.isMyTurn) { scan.status = '내 턴이 아니에요(굴린 주사위가 없습니다)'; return; }
      const mapped = boardStateToSt(board);
      pushHistory();
      st.me = mapped.me;
      st.opp = mapped.opp;
      die.value = mapped.die || null;
      ui.bonusMode = mapped.bonusMode;
      ui.selected = null;
      if (gate.ok) { scan.status = `인식 완료(${scan.lastMs}ms) — 계산합니다`; solve(); }
      else { scan.status = `인식했지만 확인 필요(${gate.reasons.join(', ')}) — 노란 라인을 확인·수정 후 [추천] 하세요`; }
    }
    function scanRowWarn(li) {
      const f = scan.flags;
      if (!f || !f.lines) return false;
      const m = f.lines.me[li], o = f.lines.opp[li];
      return !!((m && (m.lowConf || m.impossible)) || (o && (o.lowConf || o.impossible)));
    }
```

> 참고: `applyScan`/`scanRowWarn`는 함수 선언(호이스팅)이라 `visionWorker.onmessage`보다 뒤에 정의돼도 동작한다. `st`/`die`/`ui`/`pushHistory`/`solve`는 같은 setup 스코프에 이미 있음.

- [ ] **Step 3: app.js return에 노출 추가** — `return { ... }` 객체에 추가:

```js
      scan, scanConnect, scanDisconnect, scanNow, scanRowWarn,
```

- [ ] **Step 4: index.html 툴바에 스캔 컨트롤 추가** — `board-toolbar`(20~21행)의 "전체 비우기" 버튼 다음 줄에:

```html
          <button class="tool-btn" v-if="!scan.connected" @click="scanConnect()">🖥️ 화면 연결</button>
          <button class="tool-btn scan-go" v-else :disabled="scan.busy" @click="scanNow()">📷 스캔</button>
          <button class="tool-btn" v-if="scan.connected" @click="scanDisconnect()">⛔ 연결 끊기</button>
          <span class="scan-status" v-if="scan.status">{{ scan.status }}</span>
```

- [ ] **Step 5: index.html 보드 행에 강조 바인딩** — `vs-row`(28행)의 `:class`를 교체:

```html
          <div v-for="li in 3" :key="li" class="vs-row" :class="{ 'row-rec': rowRec(li - 1), 'scan-warn': scanRowWarn(li - 1) }">
```

- [ ] **Step 6: styles.css에 스타일 추가** — 파일 끝에:

```css
/* 화면 인식 */
.scan-status { font-size: 0.85rem; color: var(--muted, #9aa); margin-left: 0.5rem; }
.tool-btn.scan-go { border-color: var(--gold, #c9a227); }
.vs-row.scan-warn { outline: 2px solid #e6c200; outline-offset: 2px; border-radius: 6px; }
```

> `var(--muted/--gold)` 미정의면 styles.css의 실제 토큰명으로 맞출 것(없으면 리터럴 색 사용).

- [ ] **Step 7: 구문 점검**

Run: `node --check app.js`
Expected: 출력 없음(구문 OK).

- [ ] **Step 8: 전체 회귀(기존 테스트 불변)**

Run: `node --test`
Expected: fail 0 (app.js/index.html은 테스트가 import하지 않음).

- [ ] **Step 9: 실브라우저 수동 검증** — 로컬 정적 서버(예: `npx serve` 또는 Vercel 프리뷰)로 페이지 열기. 체크리스트:
  - [ ] "화면 연결" → 공유 선택창에서 **창 → 로스트아크** 선택 → 상태 "연결됨".
  - [ ] 내 턴(좌측 홀딩박스에 주사위)에서 "스캔" → 보드가 채워지고 굴린 주사위 설정 + 자동 추천 실행. 상태에 `(NNNms)` 표시 → **이 ms를 기록**(연속 루프 타당성 근거).
  - [ ] 상대 턴 화면에서 "스캔" → "내 턴이 아니에요" 안내, 보드 미변경.
  - [ ] (가능하면) 다른 해상도/전체화면 아닐 때 → 인식 보류/오인식 시 노란 라인 강조 + "확인 필요" 안내. 기존 칸 클릭으로 수동 수정 가능, 되돌리기 동작.
  - [ ] "연결 끊기" → 공유 중단.
  - [ ] 솔버/기존 입력(숫자패드·실드·밑장빼기 토글)·되돌리기가 **그대로** 동작(회귀 없음).

- [ ] **Step 10: 커밋**

```bash
git add app.js index.html styles.css
git commit -m "feat(vision): 스캔 UI 결선 - 화면연결/스냅샷 스캔/자동적용/라인강조/정직한 Tier1 한계"
```

---

## 빌드 후 마무리

- [ ] 전체 브랜치 리뷰(opus): 무의존성·브라우저 안전(순수 모듈에 전역 누수 없음)·기존 앱 회귀 0·frame 계약 일관·정직한 한계 안내 확인.
- [ ] `finishing-a-development-branch`: 사용자 승인 후 main 병합 + Vercel 배포. 배포 후 실사이트에서 Step 9 체크리스트 재확인(특히 인식 ms).
- [ ] 메모리/원장 갱신: 측정된 인식 ms를 [[screen-recognition-resume]]에 기록(다음 증분 = 연속 루프 GO/NO-GO 근거).

## Self-Review (작성자 체크)

- **스펙 커버리지:** §1 모듈경계→T1~T7, §1.1 앵커속도→T3, §2 데이터흐름→T7, §3 자동적용/pushHistory→T2(게이트)·T7(적용), §4 에러/엣지→T5(검은프레임)·T7(권한/턴/끊김/미지원), §5 테스트→각 T, §6 코어후속(holdMine 가드/anyLowConf NaN)→T4·T1, §8 빌드순서→T1..T7 순서 일치. ✅
- **플레이스홀더:** 없음(모든 코드 단계에 실제 코드). ✅
- **타입 일관성:** `toBoardState`가 내보내는 `lines:{me,opp}[{lowConf,impossible}]`를 `scanGate`가 그대로 소비; `boardStateToSt`의 `{me,opp,die,bonusMode}`를 T7이 `st.me/st.opp/die.value/ui.bonusMode`에 대입. `findAnchor(…, opts)` 추가 인자 하위호환. ✅
- **범위:** 단일 증분(스냅샷+Tier1). 연속 루프·Tier2는 명시적 범위 밖. ✅
