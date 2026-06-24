# 티카투카 AI 어시스턴트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 티카투카 주사위 게임에서 현재 판 상태를 수동 입력하면, 이길 확률이 가장 높은 수(+승률)와 밑장빼기 권장 여부를 알려주는 웹 어시스턴트를 만든다.

**Architecture:** 3층 분리 — ① 게임 엔진(순수 ES 모듈: 상태/점수/규칙), ② 솔버(하이브리드: 중반 몬테카를로, 후반 완전탐색 기댓값 미니맥스), ③ UI(Vue 3 + 로아도쓰 다크/골드 테마). 솔버는 Web Worker에서 실행해 화면을 막지 않는다. 엔진/솔버는 DOM·Vue에 의존하지 않는 순수 모듈이라 Node `--test`로 단위 테스트한다.

**Tech Stack:** Vanilla ES Modules(브라우저+Node 공용), Vue 3(global CDN), Web Worker(module), Node 24 내장 테스트 러너(`node --test`), 정적 배포(Vercel).

## Global Constraints

- 게임 이름은 **티카투카** (티카티카 아님).
- 주사위 값은 정수 1~6. 한 라인 최대 3칸, 라인 3개, 플레이어 2명(`me`/`opp`).
- 점수: 같은 값 1개=`v`, 2개=`3v`, 3개=`5v`. 실드 주사위도 점수·중복에 동일하게 포함.
- 승패: 라인별 합 비교(큰 쪽 승, 같으면 무승부). 이긴 라인 수 많은 쪽 게임 승, 같으면 전체 무승부(1:1:동점 포함).
- 알까기: 내 라인 i에 값 V를 둘 때 **상대 라인 i**에 값 V인 **비실드** 주사위가 있고 내 라인 i에 빈칸이 있으면 발동. 효과: 내 트리거 주사위는 놓이지 않고 사라짐 + 상대 라인 i의 값 V 비실드 주사위 전부 제거(실드 면역) + 랜덤값 **실드** 보너스 주사위 1개를 양쪽 아무 빈칸에 배치. 보너스는 연쇄 알까기 없음.
- 밑장빼기: 게임당 1회. 굴린 값 V를 본 뒤 발동 시 V와 **다른** 값 V2(1~6 중 V 제외 균등)를 굴려 둘 중 선택. `me`는 항상 보유, `opp`는 설정(`oppHasMitjang`)으로 결정.
- 게임 종료: 양쪽 9칸(총 18칸) 모두 채워짐.
- 상대(opp)는 시뮬레이션에서 **최적(나에게 최악)**으로 둔다고 가정.
- 모든 모듈은 ES Module 문법, import 시 `.js` 확장자 명시.
- 출력 텍스트/식별자에서 게임명은 항상 `tikatuka`/`티카투카`.
- 색상은 기존 로아도쓰 톤 사용: 배경 `oklch(0.235 0 0)`, 패널 `oklch(0.2891 0 0)`, 골드 액센트 `oklch(0.8868 0.1822 95.3226)`, 본문 `oklch(0.9067 0 0)`, 적 `oklch(0.7044 0.1872 23.18)`, 녹 `oklch(0.8003 0.1821 151.7)`. 폰트 `Noto Sans KR`.

> **Node 실행 메모:** 새 터미널을 열면 `node`/`npm`이 PATH에 잡힌다. 혹시 `node`가 안 잡히면 `C:\Program Files\nodejs\node.exe` / `npm.cmd`를 직접 호출한다. 모든 테스트는 프로젝트 폴더 `tikatuka-assistant/`에서 실행.

---

## File Structure

```
tikatuka-assistant/
  package.json            # type:module, "test":"node --test"
  vercel.json             # 정적 배포 설정
  README.md               # 실행/배포 방법
  index.html              # UI 셸 (Vue CDN, app.js, styles.css 로드)
  styles.css              # 로아도쓰 다크/골드 테마
  app.js                  # Vue 앱: 보드 입력 + Worker 호출 + 추천 렌더
  src/
    state.js              # 상태 모델: 생성/복제/종료판정/빈칸수
    scoring.js            # 점수: lineSum/lineResult/gameResult/outcomeValue
    rules.js              # 규칙: 배치/알까기/합법수/보너스타깃/밑장빼기 헬퍼
    solver/
      evaluate.js         # RNG + 휴리스틱 + 그리디 선택(롤아웃용)
      montecarlo.js       # 롤아웃 + 몬테카를로 평가 + MC 액션 평가
      exact.js            # 후반 완전탐색(기댓값 미니맥스)
      recommend.js        # 오케스트레이터: 액션 열거 → 승률 → 밑장빼기 조언
      worker.js           # Web Worker 진입점
  tests/
    state.test.js
    scoring.test.js
    rules.test.js
    evaluate.test.js
    montecarlo.test.js
    exact.test.js
    recommend.test.js
```

**책임 분리 원칙:** `src/*.js`는 순수 로직(브라우저·Node 공용, DOM/Vue 무의존). `app.js`만 Vue/DOM에 의존. 솔버 4개 파일은 각각 한 가지 역할(평가/MC/완전탐색/오케스트레이션).

---

## Task 1: 프로젝트 스캐폴드 + 상태 모델 (state.js)

**Files:**
- Create: `tikatuka-assistant/package.json`
- Create: `tikatuka-assistant/src/state.js`
- Test: `tikatuka-assistant/tests/state.test.js`

**Interfaces:**
- Produces:
  - `createState({ oppHasMitjang?: boolean, turn?: 'me'|'opp' }) -> State`
  - `cloneState(state) -> State` (깊은 복제)
  - `opponentOf(player: 'me'|'opp') -> 'opp'|'me'`
  - `boardFull(state) -> boolean`
  - `remainingEmpty(state) -> number`
  - State 타입: `{ me: Board, opp: Board, turn: 'me'|'opp' }`, Board: `{ lines: [Die[], Die[], Die[]], hasMitjang: boolean }`, Die: `{ value: 1..6, shield: boolean }`

- [ ] **Step 1: 프로젝트 폴더 + package.json + git 초기화**

`tikatuka-assistant/package.json`:
```json
{
  "name": "tikatuka-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

Run (프로젝트 폴더에서):
```bash
cd tikatuka-assistant
git init
```
Expected: `Initialized empty Git repository ...`

- [ ] **Step 2: 실패하는 테스트 작성**

`tikatuka-assistant/tests/state.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, cloneState, opponentOf, boardFull, remainingEmpty } from '../src/state.js';

test('createState: 빈 보드, me는 밑장빼기 보유', () => {
  const s = createState();
  assert.equal(s.turn, 'me');
  assert.equal(s.me.hasMitjang, true);
  assert.equal(s.opp.hasMitjang, false);
  assert.deepEqual(s.me.lines, [[], [], []]);
  assert.equal(remainingEmpty(s), 18);
  assert.equal(boardFull(s), false);
});

test('opponentOf', () => {
  assert.equal(opponentOf('me'), 'opp');
  assert.equal(opponentOf('opp'), 'me');
});

test('cloneState: 독립 복제(원본 불변)', () => {
  const s = createState();
  const c = cloneState(s);
  c.me.lines[0].push({ value: 5, shield: false });
  assert.equal(s.me.lines[0].length, 0);
  assert.equal(c.me.lines[0].length, 1);
});

test('boardFull/remainingEmpty: 18칸 채우면 종료', () => {
  const s = createState();
  for (const p of ['me', 'opp']) for (const l of s[p].lines) l.push({ value: 1, shield: false }, { value: 2, shield: false }, { value: 3, shield: false });
  assert.equal(remainingEmpty(s), 0);
  assert.equal(boardFull(s), true);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --test tests/state.test.js`
Expected: FAIL — `Cannot find module '../src/state.js'`

- [ ] **Step 4: 최소 구현**

`tikatuka-assistant/src/state.js`:
```js
export function createState({ oppHasMitjang = false, turn = 'me' } = {}) {
  return {
    me: { lines: [[], [], []], hasMitjang: true },
    opp: { lines: [[], [], []], hasMitjang: oppHasMitjang },
    turn,
  };
}

export function cloneState(state) {
  return {
    me: {
      lines: state.me.lines.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      hasMitjang: state.me.hasMitjang,
    },
    opp: {
      lines: state.opp.lines.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      hasMitjang: state.opp.hasMitjang,
    },
    turn: state.turn,
  };
}

export function opponentOf(player) {
  return player === 'me' ? 'opp' : 'me';
}

export function boardFull(state) {
  return ['me', 'opp'].every((p) => state[p].lines.every((l) => l.length >= 3));
}

export function remainingEmpty(state) {
  let n = 0;
  for (const p of ['me', 'opp']) for (const l of state[p].lines) n += 3 - l.length;
  return n;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/state.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json src/state.js tests/state.test.js
git commit -m "feat: 프로젝트 스캐폴드 + 게임 상태 모델"
```

---

## Task 2: 점수 계산 (scoring.js)

**Files:**
- Create: `tikatuka-assistant/src/scoring.js`
- Test: `tikatuka-assistant/tests/scoring.test.js`

**Interfaces:**
- Consumes: State/Die 타입 (Task 1)
- Produces:
  - `lineSum(line: Die[]) -> number`
  - `lineResult(myLine, oppLine) -> 'me'|'opp'|'draw'`
  - `gameResult(state) -> 'me'|'opp'|'draw'`
  - `outcomeValue(result) -> 1 | 0.5 | 0`

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/scoring.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineSum, lineResult, gameResult, outcomeValue } from '../src/scoring.js';

const D = (value, shield = false) => ({ value, shield });

test('lineSum: 단순합/더블/트리플/혼합', () => {
  assert.equal(lineSum([D(3), D(1)]), 4);
  assert.equal(lineSum([D(5), D(5)]), 15);        // 더블
  assert.equal(lineSum([D(5), D(5), D(5)]), 25);  // 트리플
  assert.equal(lineSum([D(3), D(3), D(5)]), 14);  // 3더블(9) + 5
  assert.equal(lineSum([]), 0);
});

test('lineSum: 실드도 동일하게 계산', () => {
  assert.equal(lineSum([D(6, true), D(6, false)]), 18); // 더블
});

test('lineResult', () => {
  assert.equal(lineResult([D(6)], [D(5)]), 'me');
  assert.equal(lineResult([D(4)], [D(6)]), 'opp');
  assert.equal(lineResult([D(5)], [D(5)]), 'draw');
});

test('gameResult: 2라인 승=게임 승', () => {
  const s = {
    me: { lines: [[D(6)], [D(6)], [D(1)]], hasMitjang: true },
    opp: { lines: [[D(5)], [D(5)], [D(6)]], hasMitjang: false },
    turn: 'me',
  };
  assert.equal(gameResult(s), 'me');
});

test('gameResult: 1:1:동점 → 전체 무승부', () => {
  const s = {
    me: { lines: [[D(6)], [D(2)], [D(5)]], hasMitjang: true },
    opp: { lines: [[D(5)], [D(6)], [D(5)]], hasMitjang: false },
    turn: 'me',
  };
  assert.equal(gameResult(s), 'draw');
});

test('outcomeValue', () => {
  assert.equal(outcomeValue('me'), 1);
  assert.equal(outcomeValue('draw'), 0.5);
  assert.equal(outcomeValue('opp'), 0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/scoring.test.js`
Expected: FAIL — `Cannot find module '../src/scoring.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/scoring.js`:
```js
export function lineSum(line) {
  const counts = {};
  for (const d of line) counts[d.value] = (counts[d.value] || 0) + 1;
  let sum = 0;
  for (const v in counts) {
    const c = counts[v];
    const val = Number(v);
    sum += c === 1 ? val : c === 2 ? 3 * val : 5 * val;
  }
  return sum;
}

export function lineResult(myLine, oppLine) {
  const a = lineSum(myLine);
  const b = lineSum(oppLine);
  return a > b ? 'me' : b > a ? 'opp' : 'draw';
}

export function gameResult(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    const r = lineResult(state.me.lines[i], state.opp.lines[i]);
    if (r === 'me') me++;
    else if (r === 'opp') opp++;
  }
  return me > opp ? 'me' : opp > me ? 'opp' : 'draw';
}

export function outcomeValue(result) {
  return result === 'me' ? 1 : result === 'draw' ? 0.5 : 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/scoring.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/scoring.js tests/scoring.test.js
git commit -m "feat: 점수/승패 계산 (더블·트리플·라인 비교)"
```

---

## Task 3: 규칙 엔진 (rules.js)

**Files:**
- Create: `tikatuka-assistant/src/rules.js`
- Test: `tikatuka-assistant/tests/rules.test.js`

**Interfaces:**
- Consumes: `cloneState`, `opponentOf` (Task 1)
- Produces:
  - `lineSpace(line) -> number`
  - `legalLines(state, player) -> number[]` (빈칸 있는 라인 인덱스)
  - `emptyTargets(state) -> {side:'me'|'opp', lineIndex:number}[]` (양쪽 빈칸 모두)
  - `wouldTriggerAlkkagi(state, player, lineIndex, value) -> boolean`
  - `resolveAlkkagi(state, player, lineIndex, value) -> State` (트리거 주사위 미배치 + 상대 같은값 비실드 제거)
  - `placeDie(state, player, lineIndex, die) -> State` (die={value,shield})
  - `endTurn(state) -> State` (턴 전환)
  - `setMitjang(state, player, value) -> State`
  - `rerollValues(value) -> number[]` (1~6 중 value 제외)

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/rules.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import {
  lineSpace, legalLines, emptyTargets, wouldTriggerAlkkagi,
  resolveAlkkagi, placeDie, endTurn, setMitjang, rerollValues,
} from '../src/rules.js';

const D = (value, shield = false) => ({ value, shield });

test('legalLines/lineSpace: 가득 찬 라인은 제외', () => {
  const s = createState();
  s.me.lines[1] = [D(1), D(2), D(3)];
  assert.equal(lineSpace(s.me.lines[1]), 0);
  assert.deepEqual(legalLines(s, 'me'), [0, 2]);
});

test('placeDie: 해당 라인에 주사위 추가(원본 불변)', () => {
  const s = createState();
  const s2 = placeDie(s, 'me', 0, D(5));
  assert.equal(s2.me.lines[0].length, 1);
  assert.equal(s.me.lines[0].length, 0);
});

test('wouldTriggerAlkkagi: 같은 라인 비실드 일치 + 내 빈칸', () => {
  const s = createState();
  s.opp.lines[0] = [D(5)];
  assert.equal(wouldTriggerAlkkagi(s, 'me', 0, 5), true);  // 같은 라인 일치
  assert.equal(wouldTriggerAlkkagi(s, 'me', 1, 5), false); // 다른 라인엔 없음
  assert.equal(wouldTriggerAlkkagi(s, 'me', 0, 4), false); // 값 다름
});

test('wouldTriggerAlkkagi: 상대 실드는 트리거 안 됨', () => {
  const s = createState();
  s.opp.lines[0] = [D(5, true)];
  assert.equal(wouldTriggerAlkkagi(s, 'me', 0, 5), false);
});

test('wouldTriggerAlkkagi: 내 라인 꽉 차면 발동 안 함', () => {
  const s = createState();
  s.me.lines[0] = [D(1), D(2), D(3)];
  s.opp.lines[0] = [D(5)];
  assert.equal(wouldTriggerAlkkagi(s, 'me', 0, 5), false);
});

test('resolveAlkkagi: 같은 라인 비실드만 제거, 실드/다른값/다른라인 유지', () => {
  const s = createState();
  s.opp.lines[0] = [D(5), D(5, true), D(3)];
  s.opp.lines[1] = [D(5)];
  const r = resolveAlkkagi(s, 'me', 0, 5);
  assert.deepEqual(r.opp.lines[0], [D(5, true), D(3)]); // 비실드 5만 제거
  assert.deepEqual(r.opp.lines[1], [D(5)]);             // 다른 라인 불변
  assert.equal(r.me.lines[0].length, 0);               // 내 트리거 주사위는 놓이지 않음
});

test('emptyTargets: 양쪽 빈칸 모두 포함', () => {
  const s = createState();
  s.me.lines[0] = [D(1), D(2), D(3)];
  const t = emptyTargets(s);
  assert.equal(t.some((x) => x.side === 'me' && x.lineIndex === 0), false);
  assert.equal(t.some((x) => x.side === 'opp' && x.lineIndex === 0), true);
});

test('endTurn: 턴 전환', () => {
  assert.equal(endTurn(createState()).turn, 'opp');
});

test('setMitjang / rerollValues', () => {
  assert.equal(setMitjang(createState(), 'me', false).me.hasMitjang, false);
  assert.deepEqual(rerollValues(3), [1, 2, 4, 5, 6]);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/rules.test.js`
Expected: FAIL — `Cannot find module '../src/rules.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/rules.js`:
```js
import { cloneState, opponentOf } from './state.js';

export function lineSpace(line) {
  return 3 - line.length;
}

export function legalLines(state, player) {
  const out = [];
  for (let i = 0; i < 3; i++) if (state[player].lines[i].length < 3) out.push(i);
  return out;
}

export function emptyTargets(state) {
  const out = [];
  for (const side of ['me', 'opp']) {
    for (let i = 0; i < 3; i++) if (state[side].lines[i].length < 3) out.push({ side, lineIndex: i });
  }
  return out;
}

export function wouldTriggerAlkkagi(state, player, lineIndex, value) {
  const opp = opponentOf(player);
  const hasSpace = state[player].lines[lineIndex].length < 3;
  const hasMatch = state[opp].lines[lineIndex].some((d) => d.value === value && !d.shield);
  return hasSpace && hasMatch;
}

export function resolveAlkkagi(state, player, lineIndex, value) {
  const s = cloneState(state);
  const opp = opponentOf(player);
  s[opp].lines[lineIndex] = s[opp].lines[lineIndex].filter((d) => !(d.value === value && !d.shield));
  return s;
}

export function placeDie(state, player, lineIndex, die) {
  const s = cloneState(state);
  s[player].lines[lineIndex] = [...s[player].lines[lineIndex], { value: die.value, shield: !!die.shield }];
  return s;
}

export function endTurn(state) {
  const s = cloneState(state);
  s.turn = opponentOf(state.turn);
  return s;
}

export function setMitjang(state, player, value) {
  const s = cloneState(state);
  s[player].hasMitjang = value;
  return s;
}

export function rerollValues(value) {
  const out = [];
  for (let v = 1; v <= 6; v++) if (v !== value) out.push(v);
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/rules.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/rules.js tests/rules.test.js
git commit -m "feat: 규칙 엔진 (배치·알까기·합법수·밑장빼기 헬퍼)"
```

---

## Task 4: 평가 함수 + RNG + 그리디 (evaluate.js)

**Files:**
- Create: `tikatuka-assistant/src/solver/evaluate.js`
- Test: `tikatuka-assistant/tests/evaluate.test.js`

**Interfaces:**
- Consumes: `lineSum`(scoring), `legalLines/wouldTriggerAlkkagi/resolveAlkkagi/placeDie/emptyTargets`(rules)
- Produces:
  - `makeRng(seed: number) -> () => number` (0~1 결정적 난수)
  - `rollDie(rng) -> 1..6`
  - `pAtLeastTwo(a,b,c) -> number` (3개 중 ≥2 성공 확률)
  - `lineWinProb(state, lineIndex) -> number` (0.02~0.98)
  - `heuristicValue(state) -> number` (me 관점 0~1, ≈P(2라인 이상 승))
  - `chooseScore(player, state) -> number` (그 플레이어 입장 점수: me면 heuristicValue, opp면 1-heuristicValue)
  - `greedyMove(state, value, rng) -> { lineIndex:number, alkkagi:boolean } | null`
  - `greedyBonusPlace(state, player, b, rng) -> State`

상수: `HEUR_K = 7`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/evaluate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { makeRng, rollDie, pAtLeastTwo, lineWinProb, heuristicValue, greedyMove } from '../src/solver/evaluate.js';

const D = (value, shield = false) => ({ value, shield });

test('makeRng: 같은 시드 = 같은 수열(결정적)', () => {
  const a = makeRng(42); const b = makeRng(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('rollDie: 1~6 범위', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 200; i++) {
    const v = rollDie(rng);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v));
  }
});

test('pAtLeastTwo: 경계값', () => {
  assert.equal(pAtLeastTwo(1, 1, 1), 1);
  assert.equal(pAtLeastTwo(0, 0, 0), 0);
  assert.ok(Math.abs(pAtLeastTwo(0.5, 0.5, 0.5) - 0.5) < 1e-9);
});

test('lineWinProb: 앞서면 0.5 초과, 뒤지면 0.5 미만', () => {
  const s = createState();
  s.me.lines[0] = [D(6), D(6)]; // 18
  s.opp.lines[0] = [D(2)];      // 2
  assert.ok(lineWinProb(s, 0) > 0.5);
  assert.ok(lineWinProb(s, 1) > 0.49 && lineWinProb(s, 1) < 0.51); // 빈 라인 무승부 근처
  const s2 = createState();
  s2.opp.lines[0] = [D(6), D(6)];
  assert.ok(lineWinProb(s2, 0) < 0.5);
});

test('heuristicValue: 모든 라인 압도 시 1에 근접', () => {
  const s = createState();
  for (let i = 0; i < 3; i++) { s.me.lines[i] = [D(6), D(6)]; s.opp.lines[i] = [D(1)]; }
  assert.ok(heuristicValue(s) > 0.9);
});

test('greedyMove: 상대 중복 제거각(알까기)을 선택', () => {
  const s = createState();
  s.opp.lines[0] = [D(6), D(6)]; // 라인0에 6 두 개 → 알까기로 제거 가능
  const move = greedyMove(s, 6, makeRng(7));
  assert.equal(move.lineIndex, 0);
  assert.equal(move.alkkagi, true);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/evaluate.test.js`
Expected: FAIL — `Cannot find module '../src/solver/evaluate.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/solver/evaluate.js`:
```js
import { lineSum } from '../scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie } from '../rules.js';

const HEUR_K = 7;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

export function pAtLeastTwo(a, b, c) {
  return a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c + a * b * c;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function dupCount(line) {
  // 같은 값(비실드)이 2개 이상인 주사위 개수 (0/2/3)
  const counts = {};
  for (const d of line) if (!d.shield) counts[d.value] = (counts[d.value] || 0) + 1;
  let dup = 0;
  for (const v in counts) if (counts[v] >= 2) dup += counts[v];
  return dup;
}

export function lineWinProb(state, i) {
  const my = lineSum(state.me.lines[i]);
  const op = lineSum(state.opp.lines[i]);
  let margin = my - op;
  // 상대 비실드 중복 → 내가 제거각 → 유리 가산
  margin += dupCount(state.opp.lines[i]) * 1.5;
  // 내 비실드 중복 → 상대가 제거각 → 불리 감산
  margin -= dupCount(state.me.lines[i]) * 1.0;
  // 양쪽 라인 꽉 찼고 내가 뒤지면 굳어진 패배 → 추가 페널티
  if (state.me.lines[i].length === 3 && state.opp.lines[i].length === 3 && margin < 0) margin -= 2;
  return clamp(1 / (1 + Math.exp(-margin / HEUR_K)), 0.02, 0.98);
}

export function heuristicValue(state) {
  const p = [0, 1, 2].map((i) => lineWinProb(state, i));
  return pAtLeastTwo(p[0], p[1], p[2]);
}

export function chooseScore(player, state) {
  const h = heuristicValue(state);
  return player === 'me' ? h : 1 - h;
}

export function greedyMove(state, value, rng) {
  const player = state.turn;
  const lines = legalLines(state, player);
  if (lines.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const L of lines) {
    const alkkagi = wouldTriggerAlkkagi(state, player, L, value);
    const next = alkkagi
      ? resolveAlkkagi(state, player, L, value)
      : placeDie(state, player, L, { value, shield: false });
    const sc = chooseScore(player, next) + rng() * 1e-6; // 동점 시 미세 난수
    if (sc > bestScore) {
      bestScore = sc;
      best = { lineIndex: L, alkkagi };
    }
  }
  return best;
}

export function greedyBonusPlace(state, player, b, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return state;
  let best = state;
  let bestScore = -Infinity;
  for (const t of targets) {
    const next = placeDie(state, t.side, t.lineIndex, { value: b, shield: true });
    const sc = chooseScore(player, next) + rng() * 1e-6;
    if (sc > bestScore) {
      bestScore = sc;
      best = next;
    }
  }
  return best;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/evaluate.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/solver/evaluate.js tests/evaluate.test.js
git commit -m "feat: 솔버 평가함수 + RNG + 전략기반 그리디 선택"
```

---

## Task 5: 몬테카를로 평가 (montecarlo.js)

**Files:**
- Create: `tikatuka-assistant/src/solver/montecarlo.js`
- Test: `tikatuka-assistant/tests/montecarlo.test.js`

**Interfaces:**
- Consumes: `cloneState/boardFull`(state), `gameResult/outcomeValue`(scoring), `endTurn/placeDie/resolveAlkkagi/wouldTriggerAlkkagi`(rules), `rollDie/greedyMove/greedyBonusPlace`(evaluate)
- Produces:
  - `rollout(state, rng) -> number` (1판 무작위 플레이아웃 결과값 0/0.5/1)
  - `montecarloValue(state, n, rng) -> number` (n판 평균, me 관점)
  - `mcMyPlacementValue(state, lineIndex, value, n, rng) -> number` (me가 value를 그 라인에 둔 뒤 승률)
  - `mcBonusPlacementValue(state, target, value, n, rng) -> number` (me가 실드 보너스를 target에 둔 뒤 승률)

상수: `ROLLOUT_CAP = 40`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/montecarlo.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { makeRng } from '../src/solver/evaluate.js';
import { rollout, montecarloValue, mcMyPlacementValue } from '../src/solver/montecarlo.js';

const D = (value, shield = false) => ({ value, shield });

test('rollout: 항상 0/0.5/1 중 하나', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 20; i++) {
    const v = rollout(createState(), rng);
    assert.ok(v === 0 || v === 0.5 || v === 1);
  }
});

test('montecarloValue: 0~1 범위', () => {
  const v = montecarloValue(createState(), 50, makeRng(5));
  assert.ok(v >= 0 && v <= 1);
});

test('mcMyPlacementValue: 압도적으로 이긴 보드 마무리 → 높은 승률', () => {
  // me가 두 라인 이미 크게 이기고, 마지막 한 칸만 채우면 끝나는 상황
  const s = createState();
  s.me.lines[0] = [D(6), D(6), D(6)];   // 30
  s.opp.lines[0] = [D(1), D(1), D(1)];  // 5
  s.me.lines[1] = [D(6), D(6), D(6)];   // 30
  s.opp.lines[1] = [D(1), D(1), D(1)];  // 5
  s.me.lines[2] = [D(1), D(1)];
  s.opp.lines[2] = [D(1), D(1)]; // 양쪽 라인2에 각각 1칸 남음
  const wp = mcMyPlacementValue(s, 2, 3, 200, makeRng(9));
  assert.ok(wp > 0.95, `expected >0.95, got ${wp}`);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/montecarlo.test.js`
Expected: FAIL — `Cannot find module '../src/solver/montecarlo.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/solver/montecarlo.js`:
```js
import { cloneState, boardFull } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import { endTurn, placeDie, resolveAlkkagi, wouldTriggerAlkkagi } from '../rules.js';
import { rollDie, greedyMove, greedyBonusPlace } from './evaluate.js';

const ROLLOUT_CAP = 40;

export function rollout(state, rng) {
  let s = cloneState(state);
  let depth = 0;
  while (!boardFull(s) && depth < ROLLOUT_CAP) {
    const player = s.turn;
    const r = rollDie(rng);
    const move = greedyMove(s, r, rng);
    if (!move) break;
    if (move.alkkagi) {
      s = resolveAlkkagi(s, player, move.lineIndex, r);
      const b = rollDie(rng);
      s = greedyBonusPlace(s, player, b, rng);
      s = endTurn(s);
    } else {
      s = endTurn(placeDie(s, player, move.lineIndex, { value: r, shield: false }));
    }
    depth++;
  }
  return outcomeValue(gameResult(s));
}

export function montecarloValue(state, n, rng) {
  let total = 0;
  for (let k = 0; k < n; k++) total += rollout(state, rng);
  return total / n;
}

export function mcMyPlacementValue(state, lineIndex, value, n, rng) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    let total = 0;
    for (let k = 0; k < n; k++) {
      let s1 = resolveAlkkagi(state, 'me', lineIndex, value);
      const b = rollDie(rng);
      s1 = greedyBonusPlace(s1, 'me', b, rng);
      total += rollout(endTurn(s1), rng);
    }
    return total / n;
  }
  const s = endTurn(placeDie(state, 'me', lineIndex, { value, shield: false }));
  return montecarloValue(s, n, rng);
}

export function mcBonusPlacementValue(state, target, value, n, rng) {
  const s = endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true }));
  return montecarloValue(s, n, rng);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/montecarlo.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/solver/montecarlo.js tests/montecarlo.test.js
git commit -m "feat: 몬테카를로 롤아웃 평가 (중반용)"
```

---

## Task 6: 후반 완전탐색 (exact.js)

**Files:**
- Create: `tikatuka-assistant/src/solver/exact.js`
- Test: `tikatuka-assistant/tests/exact.test.js`

**Interfaces:**
- Consumes: `boardFull/remainingEmpty`(state), `gameResult/outcomeValue`(scoring), `legalLines/emptyTargets/wouldTriggerAlkkagi/resolveAlkkagi/placeDie/endTurn/setMitjang`(rules), `heuristicValue`(evaluate)
- Produces:
  - `defaultBudget(state) -> number`
  - `searchValue(state, budget) -> number` (기댓값 미니맥스, me 관점)
  - `exactMyPlacementValue(state, lineIndex, value, budget?) -> number`
  - `exactBonusPlacementValue(state, target, value, budget?) -> number`

내부(미export): `turnValueExact`, `bestPlacementExact`, `bonusValueExact`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/exact.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { searchValue, exactMyPlacementValue, defaultBudget } from '../src/solver/exact.js';

const D = (value, shield = false) => ({ value, shield });

// 거의 다 찬 보드: me가 라인0/1을 확정으로 이기고 라인2만 한 칸씩 남음
function nearEndState() {
  const s = createState();
  s.me.lines[0] = [D(6), D(6), D(6)];  // 30
  s.opp.lines[0] = [D(1), D(1), D(1)]; // 5  → me 승 확정
  s.me.lines[1] = [D(6), D(6), D(6)];  // 30
  s.opp.lines[1] = [D(1), D(1), D(1)]; // 5  → me 승 확정
  s.me.lines[2] = [D(1), D(1)];
  s.opp.lines[2] = [D(1), D(1)];
  s.me.hasMitjang = false;
  s.opp.hasMitjang = false;
  return s; // remainingEmpty = 2
}

test('defaultBudget: 빈칸 수 기반', () => {
  assert.ok(defaultBudget(nearEndState()) >= 2);
});

test('searchValue: 2라인 이미 승 확정 → 승률 1', () => {
  const s = nearEndState();
  // 라인2 결과와 무관하게 me가 라인0,1을 이미 이김 → 게임 승 확정
  assert.ok(Math.abs(searchValue(s, defaultBudget(s)) - 1) < 1e-9);
});

test('exactMyPlacementValue: 어느 칸에 둬도 승 확정', () => {
  const s = nearEndState();
  assert.ok(Math.abs(exactMyPlacementValue(s, 2, 5) - 1) < 1e-9);
});

test('searchValue: 졌을 때 0 (대칭 확인)', () => {
  const s = nearEndState();
  // me/opp 라인0,1을 뒤집어 opp가 두 라인 확정 승
  const swapped = {
    me: s.opp, opp: s.me, turn: 'me',
  };
  assert.ok(Math.abs(searchValue(swapped, defaultBudget(swapped)) - 0) < 1e-9);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/exact.test.js`
Expected: FAIL — `Cannot find module '../src/solver/exact.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/solver/exact.js`:
```js
import { boardFull, remainingEmpty } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import {
  legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn, setMitjang,
} from '../rules.js';
import { heuristicValue } from './evaluate.js';

export function defaultBudget(state) {
  return Math.min(remainingEmpty(state) + 2, 14);
}

export function searchValue(state, budget) {
  if (boardFull(state)) return outcomeValue(gameResult(state));
  if (budget <= 0) return heuristicValue(state);
  const player = state.turn;
  let acc = 0;
  for (let r = 1; r <= 6; r++) acc += turnValueExact(state, player, r, budget) / 6;
  return acc;
}

function turnValueExact(state, player, r, budget) {
  const agg = player === 'me' ? Math.max : Math.min;
  const noMit = bestPlacementExact(state, player, r, budget);
  if (!state[player].hasMitjang) return noMit;
  const consumed = setMitjang(state, player, false);
  const vR = bestPlacementExact(consumed, player, r, budget);
  let acc = 0;
  let count = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === r) continue;
    const vR2 = bestPlacementExact(consumed, player, r2, budget);
    acc += agg(vR, vR2);
    count++;
  }
  return agg(noMit, acc / count);
}

function bestPlacementExact(state, player, value, budget) {
  const lines = legalLines(state, player);
  if (lines.length === 0) return heuristicValue(state);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const L of lines) {
    let v;
    if (wouldTriggerAlkkagi(state, player, L, value)) {
      const s1 = resolveAlkkagi(state, player, L, value);
      let bAcc = 0;
      for (let b = 1; b <= 6; b++) bAcc += bonusValueExact(s1, player, b, budget) / 6;
      v = bAcc;
    } else {
      v = searchValue(endTurn(placeDie(state, player, L, { value, shield: false })), budget - 1);
    }
    result = agg(result, v);
  }
  return result;
}

function bonusValueExact(state, player, b, budget) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return searchValue(endTurn(state), budget - 1);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const t of targets) {
    const s = endTurn(placeDie(state, t.side, t.lineIndex, { value: b, shield: true }));
    result = agg(result, searchValue(s, budget - 1));
  }
  return result;
}

export function exactMyPlacementValue(state, lineIndex, value, budget = defaultBudget(state)) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    const s1 = resolveAlkkagi(state, 'me', lineIndex, value);
    let acc = 0;
    for (let b = 1; b <= 6; b++) acc += bonusValueExact(s1, 'me', b, budget) / 6;
    return acc;
  }
  return searchValue(endTurn(placeDie(state, 'me', lineIndex, { value, shield: false })), budget - 1);
}

export function exactBonusPlacementValue(state, target, value, budget = defaultBudget(state)) {
  return searchValue(endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true })), budget - 1);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/exact.test.js`
Expected: PASS (4 tests)

> **성능 메모:** 완전탐색은 빈칸이 적은 후반에만 사용한다(Task 7의 `EXACT_THRESHOLD`). 만약 후반 계산이 느리면 `EXACT_THRESHOLD`를 낮춘다(4 → 3).

- [ ] **Step 5: 커밋**

```bash
git add src/solver/exact.js tests/exact.test.js
git commit -m "feat: 후반 완전탐색 (기댓값 미니맥스 + 알까기/밑장빼기)"
```

---

## Task 7: 추천 오케스트레이터 (recommend.js)

**Files:**
- Create: `tikatuka-assistant/src/solver/recommend.js`
- Test: `tikatuka-assistant/tests/recommend.test.js`

**Interfaces:**
- Consumes: `remainingEmpty`(state), `legalLines/emptyTargets/wouldTriggerAlkkagi/setMitjang`(rules), `makeRng`(evaluate), `mcMyPlacementValue/mcBonusPlacementValue`(montecarlo), `exactMyPlacementValue/exactBonusPlacementValue/defaultBudget`(exact)
- Produces:
  - `recommend(state, die, opts) -> Result`
    - `opts`: `{ isBonus?: boolean, seed?: number }`
    - `Result`: `{ options: Option[], best: Option|null, mitjang: Mitjang|null }`
    - `Option`: `{ target: {side:'me'|'opp', lineIndex:number}, alkkagi: boolean, winProb: number }`
    - `Mitjang`: `{ recommend: boolean, baseWinProb: number, mitjangWinProb: number }`
    - 일반 모드: `die`를 내 라인에 배치(알까기 가능), 밑장빼기 조언 포함.
    - 보너스 모드(`isBonus:true`): `die`는 실드, 양쪽 빈칸 배치 후보, 알까기/밑장빼기 없음.

상수: `EXACT_THRESHOLD = 4`, `MC_ROLLOUTS = 400`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tikatuka-assistant/tests/recommend.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { recommend } from '../src/solver/recommend.js';

const D = (value, shield = false) => ({ value, shield });

test('recommend: 옵션은 승률 내림차순, best=최고승률', () => {
  const s = createState();
  s.me.hasMitjang = false;
  const r = recommend(s, 4, { seed: 1 });
  assert.ok(r.options.length > 0);
  for (let i = 1; i < r.options.length; i++) {
    assert.ok(r.options[i - 1].winProb >= r.options[i].winProb);
  }
  assert.equal(r.best, r.options[0]);
});

test('recommend: 후반 상대 중복 제거각을 최선으로 추천(알까기)', () => {
  // 빈칸 적은 후반(완전탐색). opp 라인0에 6 두 개 방치 시 라인 넘어감 → 6으로 알까기 추천
  const s = createState();
  s.me.hasMitjang = false;
  s.opp.hasMitjang = false;
  s.me.lines[0] = [D(2)];
  s.opp.lines[0] = [D(6), D(6)];          // 알까기 표적
  s.me.lines[1] = [D(5), D(5), D(5)];     // 25, me 확정 승
  s.opp.lines[1] = [D(1), D(1), D(1)];
  s.me.lines[2] = [D(1), D(1), D(1)];
  s.opp.lines[2] = [D(6), D(6), D(6)];    // opp 확정 승
  const r = recommend(s, 6, { seed: 2 });
  assert.equal(r.best.alkkagi, true);
  assert.equal(r.best.target.lineIndex, 0);
});

test('recommend(isBonus): 양쪽 필드 모두 배치 후보로 등장', () => {
  const s = createState();
  s.me.hasMitjang = false;
  const r = recommend(s, 6, { isBonus: true, seed: 3 });
  assert.ok(r.options.some((o) => o.target.side === 'me'));
  assert.ok(r.options.some((o) => o.target.side === 'opp'));
  assert.equal(r.mitjang, null); // 보너스 모드는 밑장빼기 조언 없음
});

test('recommend: 밑장빼기 보유 시 조언 객체 반환', () => {
  const s = createState(); // me.hasMitjang = true 기본
  const r = recommend(s, 1, { seed: 4 });
  assert.ok(r.mitjang !== null);
  assert.equal(typeof r.mitjang.recommend, 'boolean');
  assert.ok(r.mitjang.baseWinProb >= 0 && r.mitjang.baseWinProb <= 1);
  assert.ok(r.mitjang.mitjangWinProb >= 0 && r.mitjang.mitjangWinProb <= 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/recommend.test.js`
Expected: FAIL — `Cannot find module '../src/solver/recommend.js'`

- [ ] **Step 3: 최소 구현**

`tikatuka-assistant/src/solver/recommend.js`:
```js
import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import { exactMyPlacementValue, exactBonusPlacementValue, defaultBudget } from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 400;

export function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const rng = makeRng(opts.seed ?? 1234567);
  const exact = remainingEmpty(state) <= EXACT_THRESHOLD;
  const budget = defaultBudget(state);

  const evalMy = (L) =>
    exact ? exactMyPlacementValue(state, L, die, budget) : mcMyPlacementValue(state, L, die, MC_ROLLOUTS, rng);
  const evalBonus = (t) =>
    exact ? exactBonusPlacementValue(state, t, die, budget) : mcBonusPlacementValue(state, t, die, MC_ROLLOUTS, rng);

  const options = [];
  if (isBonus) {
    for (const t of emptyTargets(state)) {
      options.push({ target: t, alkkagi: false, winProb: evalBonus(t) });
    }
  } else {
    for (const L of legalLines(state, 'me')) {
      options.push({
        target: { side: 'me', lineIndex: L },
        alkkagi: wouldTriggerAlkkagi(state, 'me', L, die),
        winProb: evalMy(L),
      });
    }
  }
  options.sort((a, b) => b.winProb - a.winProb);
  const best = options[0] ?? null;

  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && best) {
    const baseWinProb = best.winProb;
    const mitjangWinProb = mitjangValue(state, die, exact, budget, rng);
    mitjang = { recommend: mitjangWinProb > baseWinProb + 0.01, baseWinProb, mitjangWinProb };
  }

  return { options, best, mitjang };
}

function bestMyValue(state, value, exact, budget, rng) {
  let best = -Infinity;
  for (const L of legalLines(state, 'me')) {
    const wp = exact
      ? exactMyPlacementValue(state, L, value, budget)
      : mcMyPlacementValue(state, L, value, MC_ROLLOUTS, rng);
    if (wp > best) best = wp;
  }
  return best === -Infinity ? 0 : best;
}

function mitjangValue(state, die, exact, budget, rng) {
  const consumed = setMitjang(state, 'me', false);
  const vDie = bestMyValue(consumed, die, exact, budget, rng);
  let acc = 0;
  let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === die) continue;
    const vR2 = bestMyValue(consumed, r2, exact, budget, rng);
    acc += Math.max(vDie, vR2);
    n++;
  }
  return acc / n;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/recommend.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `node --test`
Expected: PASS (전체 파일, 실패 0)

- [ ] **Step 6: 커밋**

```bash
git add src/solver/recommend.js tests/recommend.test.js
git commit -m "feat: 추천 오케스트레이터 (승률 산출 + 밑장빼기 조언)"
```

---

## Task 8: Web Worker 진입점 (worker.js)

**Files:**
- Create: `tikatuka-assistant/src/solver/worker.js`

**Interfaces:**
- Consumes: `recommend`(recommend.js)
- Produces: 메시지 프로토콜
  - 입력: `postMessage({ id, state, die, opts })`
  - 출력: `postMessage({ id, result })` 또는 `postMessage({ id, error })`

> Worker는 브라우저 전용 런타임(`self`)이라 Node 테스트 대신, recommend를 직접 호출하는 통합 스모크 테스트로 검증한다.

- [ ] **Step 1: Worker 구현**

`tikatuka-assistant/src/solver/worker.js`:
```js
import { recommend } from './recommend.js';

self.onmessage = (e) => {
  const { id, state, die, opts } = e.data;
  try {
    const result = recommend(state, die, opts || {});
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
```

- [ ] **Step 2: 통합 스모크 테스트 작성**

`tikatuka-assistant/tests/recommend.test.js`에 추가:
```js
test('통합: 중반 빈 보드에서 추천이 항상 best를 낸다', () => {
  const s = createState();
  s.me.hasMitjang = false;
  for (let die = 1; die <= 6; die++) {
    const r = recommend(s, die, { seed: die });
    assert.ok(r.best && r.best.winProb >= 0 && r.best.winProb <= 1);
  }
});
```

- [ ] **Step 3: 테스트 통과 확인**

Run: `node --test tests/recommend.test.js`
Expected: PASS (5 tests)

- [ ] **Step 4: 커밋**

```bash
git add src/solver/worker.js tests/recommend.test.js
git commit -m "feat: 솔버 Web Worker 진입점 + 통합 스모크 테스트"
```

---

## Task 9: UI 셸 + 로아도쓰 테마 (index.html, styles.css)

**Files:**
- Create: `tikatuka-assistant/index.html`
- Create: `tikatuka-assistant/styles.css`

**Interfaces:**
- `index.html`은 Vue 3 global CDN과 `app.js`(module), `styles.css`를 로드. `#app` 마운트 포인트와 Vue 템플릿 마크업 포함.
- `app.js`(Task 10)가 사용할 DOM 구조/클래스: `.board`, `.line-row`, `.slot`, `.keypad`, `.result-card` 등.

- [ ] **Step 1: index.html 작성**

`tikatuka-assistant/index.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>티카투카 어시스턴트 | 최적 수 추천</title>
  <link rel="icon" href="data:;base64,iVBORw0KGgo=" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Outfit:wght@800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="./styles.css" />
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
</head>
<body>
  <div id="app">
    <div class="container">
      <h1>티카투카 어시스턴트</h1>
      <p class="subtitle">현재 판을 입력하면 이길 확률이 가장 높은 수를 알려드려요.</p>

      <div class="panel">
        <div class="board board-opp">
          <div class="board-title">상대 필드</div>
          <div v-for="(line, li) in opp" :key="'o'+li" class="line-row">
            <span class="line-label">라인 {{ li + 1 }}</span>
            <div class="slots">
              <button
                v-for="si in 3" :key="si"
                class="slot"
                :class="slotClass('opp', li, si - 1)"
                @click="selectSlot('opp', li, si - 1)">
                {{ slotText('opp', li, si - 1) }}
              </button>
            </div>
            <span class="line-sum">합 {{ sumOf('opp', li) }}</span>
          </div>
        </div>

        <div class="board board-me">
          <div class="board-title">내 필드</div>
          <div v-for="(line, li) in me" :key="'m'+li" class="line-row">
            <span class="line-label">라인 {{ li + 1 }}</span>
            <div class="slots">
              <button
                v-for="si in 3" :key="si"
                class="slot"
                :class="slotClass('me', li, si - 1)"
                @click="selectSlot('me', li, si - 1)"
                :data-rec="recHighlight('me', li)">
                {{ slotText('me', li, si - 1) }}
              </button>
            </div>
            <span class="line-sum">합 {{ sumOf('me', li) }}</span>
          </div>
        </div>
      </div>

      <div class="panel controls">
        <div class="keypad-block" v-if="selected">
          <div class="keypad-title">선택한 칸: {{ selectedLabel }}</div>
          <div class="keypad">
            <button v-for="n in 6" :key="n" class="key" @click="setSlotValue(n)">{{ n }}</button>
            <button class="key key-shield" @click="toggleSlotShield()">실드</button>
            <button class="key key-clear" @click="clearSlot()">비우기</button>
          </div>
        </div>

        <div class="roll-block">
          <div class="keypad-title">내가 굴린 주사위</div>
          <div class="keypad">
            <button
              v-for="n in 6" :key="n"
              class="key" :class="{ active: die === n }"
              @click="die = n">{{ n }}</button>
          </div>
        </div>

        <div class="options-row">
          <label class="chk"><input type="checkbox" v-model="bonusMode" /> 보너스 주사위(실드·양쪽 배치)</label>
          <label class="chk"><input type="checkbox" v-model="myMitjang" /> 내 밑장빼기 남음</label>
          <label class="chk"><input type="checkbox" v-model="oppMitjang" /> 상대 밑장빼기 사용</label>
        </div>

        <button class="solve-btn" :disabled="!die || solving" @click="solve()">
          {{ solving ? '계산 중…' : '추천 계산 ▶' }}
        </button>
      </div>

      <div class="panel result" v-if="result">
        <div class="result-card best" v-if="result.best">
          <div class="rec-line">
            ⭐ 추천: <strong>{{ targetLabel(result.best.target) }}</strong>
            <span v-if="result.best.alkkagi" class="tag-alk">알까기!</span>
          </div>
          <div class="rec-winrate" :style="winColor(result.best.winProb)">
            승률 {{ pct(result.best.winProb) }}
          </div>
        </div>

        <div class="mitjang-advice" v-if="result.mitjang">
          밑장빼기: 지금 그냥 두기 {{ pct(result.mitjang.baseWinProb) }}
          vs 밑장빼기 {{ pct(result.mitjang.mitjangWinProb) }}
          <strong v-if="result.mitjang.recommend" class="rec-yes">→ 권장 👍</strong>
          <span v-else class="rec-no">→ 아껴두기</span>
        </div>

        <div class="other-options" v-if="result.options.length > 1">
          <div class="other-title">다른 선택지</div>
          <div v-for="(o, i) in result.options.slice(1)" :key="i" class="opt-row">
            <span>{{ targetLabel(o.target) }}<span v-if="o.alkkagi" class="tag-alk-sm">알까기</span></span>
            <span :style="winColor(o.winProb)">{{ pct(o.winProb) }}</span>
          </div>
        </div>
      </div>

      <p class="footnote">승률 = 양쪽이 최선을 다하고 주사위가 무작위일 때 내가 이길 확률(보수적 추정).</p>
    </div>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: styles.css 작성 (로아도쓰 다크/골드 테마)**

`tikatuka-assistant/styles.css`:
```css
:root {
  --bg: oklch(0.235 0 0);
  --panel: oklch(0.2891 0 0);
  --panel-2: oklch(0.3485 0 0);
  --text: oklch(0.9067 0 0);
  --muted: oklch(0.7572 0 0);
  --gold: oklch(0.8868 0.1822 95.3226);
  --red: oklch(0.7044 0.1872 23.1825);
  --green: oklch(0.8003 0.1821 151.7035);
  --line: oklch(1 0 0 / 0.06);
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: "Noto Sans KR", sans-serif; color-scheme: dark;
}
.container { max-width: 760px; width: 94%; margin: 0 auto; padding: 28px 0 60px; }
h1 {
  font-family: "Outfit", "Noto Sans KR", sans-serif; font-size: 1.6em;
  text-align: center; color: #fff; margin: 0 0 4px;
}
.subtitle { text-align: center; color: var(--muted); margin: 0 0 22px; font-size: 0.95em; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 0 10px oklch(0 0 0 / 0.5); padding: 18px; margin-bottom: 18px;
}
.board-title { font-weight: 700; color: var(--gold); margin: 4px 0 10px; border-left: 4px solid var(--gold); padding-left: 8px; }
.board-me { margin-top: 18px; }
.line-row { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
.line-label { width: 56px; color: var(--muted); font-size: 0.9em; }
.slots { display: flex; gap: 8px; }
.slot {
  width: 46px; height: 46px; border-radius: 8px; font-size: 1.2em; font-weight: 700;
  background: var(--bg); color: var(--text); border: 1px solid var(--panel-2);
  cursor: pointer; transition: 0.15s;
}
.slot:hover { border-color: var(--gold); }
.slot.filled { background: var(--panel-2); }
.slot.shield { border: 2px solid var(--gold); box-shadow: 0 0 6px oklch(0.8868 0.1822 95.3226 / 0.5); }
.slot.selected { outline: 2px solid var(--gold); outline-offset: 1px; }
.slot[data-rec="1"] { background: oklch(0.8868 0.1822 95.3226 / 0.18); }
.line-sum { margin-left: auto; color: var(--muted); font-size: 0.9em; min-width: 52px; text-align: right; }
.keypad-title { color: var(--muted); font-size: 0.9em; margin: 8px 0 6px; }
.keypad { display: flex; flex-wrap: wrap; gap: 8px; }
.key {
  min-width: 46px; height: 42px; padding: 0 12px; border-radius: 8px; font-weight: 700;
  background: var(--panel-2); color: var(--text); border: 1px solid var(--line); cursor: pointer; transition: 0.15s;
}
.key:hover { background: oklch(0.4091 0 0); }
.key.active { background: var(--gold); color: #000; }
.key-shield { color: var(--gold); }
.options-row { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0 4px; }
.chk { color: var(--muted); font-size: 0.9em; display: flex; align-items: center; gap: 6px; }
.solve-btn {
  width: 100%; margin-top: 12px; padding: 14px; font-size: 1.05em; font-weight: 700;
  border: none; border-radius: 8px; background: var(--gold); color: #000; cursor: pointer; transition: 0.15s;
}
.solve-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px oklch(0 0 0 / 0.4); }
.solve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.result-card.best { text-align: center; padding: 10px 0 14px; }
.rec-line { font-size: 1.15em; }
.tag-alk { background: var(--gold); color: #000; border-radius: 6px; padding: 1px 8px; font-size: 0.75em; margin-left: 6px; font-weight: 700; }
.tag-alk-sm { color: var(--gold); font-size: 0.8em; margin-left: 6px; }
.rec-winrate { font-size: 1.8em; font-weight: 800; margin-top: 6px; }
.mitjang-advice { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 12px; color: var(--muted); font-size: 0.95em; }
.rec-yes { color: var(--green); }
.rec-no { color: var(--muted); }
.other-title { color: var(--muted); font-size: 0.85em; margin: 14px 0 6px; }
.opt-row { display: flex; justify-content: space-between; padding: 6px 4px; border-bottom: 1px solid var(--line); font-size: 0.95em; }
.footnote { color: var(--muted); font-size: 0.8em; text-align: center; margin-top: 6px; }
@media (max-width: 520px) {
  .slot { width: 40px; height: 40px; }
  .line-label { width: 44px; font-size: 0.82em; }
}
```

- [ ] **Step 3: 커밋**

```bash
git add index.html styles.css
git commit -m "feat: UI 셸 + 로아도쓰 다크/골드 테마"
```

---

## Task 10: Vue 앱 결선 + 배포 (app.js, vercel.json, README.md)

**Files:**
- Create: `tikatuka-assistant/app.js`
- Create: `tikatuka-assistant/vercel.json`
- Create: `tikatuka-assistant/README.md`

**Interfaces:**
- Consumes: `lineSum`(scoring) — 라인 합 실시간 표시. 솔버는 `src/solver/worker.js`를 module Worker로 호출.
- `app.js`는 Vue 전역 객체(`window.Vue`) 사용(모듈 import 아님), `scoring.js`만 import.

- [ ] **Step 1: app.js 작성**

`tikatuka-assistant/app.js`:
```js
import { lineSum } from './src/scoring.js';

const { createApp, ref, reactive, computed, toRefs } = window.Vue;

const worker = new Worker(new URL('./src/solver/worker.js', import.meta.url), { type: 'module' });
let msgId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const cb = pending.get(id);
  if (!cb) return;
  pending.delete(id);
  if (error) cb.reject(new Error(error));
  else cb.resolve(result);
};
function solveAsync(payload) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload });
  });
}

createApp({
  setup() {
    const st = reactive({
      me: [[], [], []],   // 각 칸: {value, shield} 또는 빈 슬롯은 배열 길이로 표현 X → 고정 길이 3, null 사용
      opp: [[], [], []],
      // 고정 3칸 슬롯 모델: 각 라인을 [slot,slot,slot]로 두고 빈칸은 null
    });
    // 슬롯 모델을 고정길이 3 + null 로 초기화
    for (const side of ['me', 'opp']) st[side] = [[null, null, null], [null, null, null], [null, null, null]];

    const die = ref(null);
    const ui = reactive({
      selected: null,       // {side, li, si}
      bonusMode: false,
      myMitjang: true,
      oppMitjang: false,
      solving: false,
      result: null,
    });

    // ---- 슬롯 조작 ----
    function selectSlot(side, li, si) {
      ui.selected = { side, li, si };
    }
    function setSlotValue(n) {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      const cur = st[side][li][si];
      st[side][li][si] = { value: n, shield: cur ? cur.shield : false };
    }
    function toggleSlotShield() {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      const cur = st[side][li][si];
      if (!cur) return;
      st[side][li][si] = { value: cur.value, shield: !cur.shield };
    }
    function clearSlot() {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      st[side][li][si] = null;
    }

    // ---- 표시 헬퍼 ----
    function lineArr(side, li) {
      return st[side][li].filter((d) => d !== null).map((d) => ({ value: d.value, shield: d.shield }));
    }
    function sumOf(side, li) { return lineSum(lineArr(side, li)); }
    function slotText(side, li, si) {
      const d = st[side][li][si];
      return d ? d.value : '·';
    }
    function slotClass(side, li, si) {
      const d = st[side][li][si];
      const sel = ui.selected && ui.selected.side === side && ui.selected.li === li && ui.selected.si === si;
      return { filled: !!d, shield: d && d.shield, selected: sel };
    }
    function recHighlight(side, li) {
      if (!ui.result || !ui.result.best) return '0';
      const t = ui.result.best.target;
      return t.side === side && t.lineIndex === li ? '1' : '0';
    }
    const selectedLabel = computed(() => {
      if (!ui.selected) return '';
      const { side, li, si } = ui.selected;
      return `${side === 'me' ? '내' : '상대'} 라인 ${li + 1} · ${si + 1}번칸`;
    });

    // ---- 상태 → 엔진 state 변환 ----
    function buildEngineState() {
      const toBoard = (side, hasMitjang) => ({
        lines: [0, 1, 2].map((li) => lineArr(side, li)),
        hasMitjang,
      });
      return {
        me: toBoard('me', ui.myMitjang),
        opp: toBoard('opp', ui.oppMitjang),
        turn: 'me',
      };
    }

    // ---- 솔브 ----
    async function solve() {
      if (!die.value) return;
      ui.solving = true;
      ui.result = null;
      try {
        const state = buildEngineState();
        const result = await solveAsync({ state, die: die.value, opts: { isBonus: ui.bonusMode, seed: 1234567 } });
        ui.result = result;
      } catch (err) {
        ui.result = { options: [], best: null, mitjang: null, _error: String(err.message) };
      } finally {
        ui.solving = false;
      }
    }

    // ---- 포맷 ----
    function pct(p) { return `${Math.round(p * 100)}%`; }
    function targetLabel(t) {
      return `${t.side === 'me' ? '내' : '상대'} 라인 ${t.lineIndex + 1}`;
    }
    function winColor(p) {
      if (p >= 0.6) return { color: 'var(--green)' };
      if (p <= 0.4) return { color: 'var(--red)' };
      return { color: 'var(--text)' };
    }

    return {
      ...toRefs(st),
      die,
      ...toRefs(ui),
      selectSlot, setSlotValue, toggleSlotShield, clearSlot,
      sumOf, slotText, slotClass, recHighlight, selectedLabel,
      solve, pct, targetLabel, winColor,
    };
  },
}).mount('#app');
```

> **주의(결선 검증 포인트):** Vue 템플릿의 `v-model="die"`, `me`/`opp` 반복, `selected`/`bonusMode`/`myMitjang`/`oppMitjang`/`solving`/`result` 바인딩이 위 `setup` 반환값과 이름이 일치해야 한다. `die`는 `get/set` 접근자로 노출한다.

- [ ] **Step 2: 로컬에서 수동 구동 확인 (브라우저)**

Run (프로젝트 폴더에서, Python 정적 서버):
```bash
python -m http.server 5500
```
브라우저에서 `http://localhost:5500/` 접속 후 확인:
1. 상대 라인0 두 칸에 6, 6 입력(칸 클릭 → 키패드 6 두 번 각 칸).
2. "내가 굴린 주사위" 6 선택 → "추천 계산".
3. 기대: **내 라인1(=라인 인덱스0)에 알까기** 추천이 뜨고 승률(%)이 표시됨. 추천 칸이 골드로 하이라이트.
4. 콘솔에 에러 없음(Worker 모듈 로딩 정상).

> module Worker는 `http://`에서만 동작한다(`file://` 불가). 반드시 서버로 연다.

- [ ] **Step 3: vercel.json + README 작성**

`tikatuka-assistant/vercel.json`:
```json
{
  "cleanUrls": true
}
```

`tikatuka-assistant/README.md`:
```markdown
# 티카투카 어시스턴트

티카투카 주사위 게임에서 현재 판을 입력하면 이길 확률이 가장 높은 수와 승률을 추천하는 웹 도구.

## 로컬 실행
정적 파일이라 빌드가 필요 없습니다. 모듈 Worker 때문에 `file://`이 아닌 HTTP 서버로 열어야 합니다.

```bash
python -m http.server 5500
# http://localhost:5500/
```

## 테스트
Node 18+ 필요. (이 PC는 C:\Program Files\nodejs 에 설치됨 — 새 터미널에서 PATH 인식)

```bash
npm test     # = node --test
```

## 배포
정적 호스팅(Vercel 등)에 폴더째 올리면 됩니다. 빌드 단계 없음.

## 사용법
1. 상대/내 필드의 각 칸을 클릭해 주사위 값을 입력(다시 클릭 후 "실드"로 실드 토글).
2. "내가 굴린 주사위" 값 선택.
3. 알까기로 받은 보너스 주사위를 둘 차례면 "보너스 주사위" 체크(실드·양쪽 배치 가능).
4. "추천 계산" → 최고 승률 수 + 밑장빼기 권장 여부 확인.
```

- [ ] **Step 4: 최종 회귀 테스트 + 커밋**

Run: `node --test`
Expected: PASS (전체)

```bash
git add app.js vercel.json README.md
git commit -m "feat: Vue 앱 결선 + 배포 설정 + README"
```

---

## Self-Review (작성자 점검 결과)

**1. 스펙 커버리지**
- 점수(더블/트리플/혼합) → Task 2 ✅
- 라인 비교·무승부·1:1:동점 → Task 2 (`gameResult`) ✅
- 알까기(같은 라인·실드 면역·내 주사위 소멸·보너스) → Task 3 + Task 5/6 보너스 처리 ✅
- 보너스 주사위(랜덤·실드·양쪽 배치·연쇄 없음) → Task 5(`mc...`)/Task 6(`bonusValueExact`)/Task 7(`isBonus`) ✅
- 밑장빼기(1회·리롤≠기존·반응형·조언) → Task 3(`rerollValues/setMitjang`) + Task 6(`turnValueExact`) + Task 7(`mitjangValue`) ✅
- 상대 최적 가정 → Task 6 미니맥스(min) + Task 5 적대적 그리디 롤아웃 ✅
- 하이브리드(중반 MC / 후반 완전탐색) → Task 7 `EXACT_THRESHOLD` 분기 ✅
- 종료(18칸) → Task 1 `boardFull` ✅
- 전략 원칙(제거각·라인 과투자 회피·실드 잠금) → Task 4 휴리스틱(`dupCount`·locked-loss·중복 가산) + Task 6 정밀 ✅
- UI(보드 입력·승률 표시·하이라이트·밑장빼기 조언·로아도쓰 테마) → Task 9/10 ✅
- Web Worker 비차단 → Task 8/10 ✅

**2. 플레이스홀더 스캔:** 모든 코드 스텝은 실행 가능한 완전 코드. TODO/TBD 없음 ✅

**3. 타입 일관성:** State/Board/Die 형태, `target:{side,lineIndex}`, `Option:{target,alkkagi,winProb}`, `recommend(state,die,opts)` 반환형이 Task 1·3·5·6·7·10에서 일치 ✅

**알려진 근사(스펙 10장과 일치):** 중반 MC 롤아웃은 그리디 정책(밑장빼기 무시)으로 적대적 추정 — 정밀 최적은 후반 완전탐색에서 보장. 필요 시 `MC_ROLLOUTS`↑ 또는 `EXACT_THRESHOLD`↑로 정확도 조정.
