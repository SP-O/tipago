# Tier2 박스 드래그 보정(수동 위치지정) 설계 — 티파고

작성 2026-06-30. 부모 설계: [`2026-06-29-screen-recognition-design.md`](2026-06-29-screen-recognition-design.md), [`2026-06-30-screen-recognition-ui-design.md`](2026-06-30-screen-recognition-ui-design.md).
선행: Plan 2(스냅샷+Tier1)는 브랜치 `feat/screen-recognition-ui`에 구현 완료(7태스크, 109 테스트, opus MERGE-READY)됐으나 **실브라우저 스모크에서 Tier1 자동앵커가 실패**. 이 문서는 그 원인을 해결하는 보정 증분이다.

## 0. 배경 — 진단 결과 (이 설계의 근거)
실제 `getDisplayMedia` 캡처 **5장**(`vision-fixtures/10-live-capture.png`, `11~14-live.png`, 2560×1440, gitignore)으로 검증. 사용자가 5장 전부 칸 정답 제공.

**(a) 자동 위치찾기(앵커) 실패** — 옛 학습 픽스처(01·02…)가 실제 화면공유 캡처와 다르게 프레임돼 있어, baked 앵커가 라이브에서 false match(perPixel≈22). ⇒ 보드 위치는 **사용자 박스 보정**으로 잡아야 함.

**(b) 실측 격자는 일관·baked와 동일 비율** — 5장 측정: 열간격 129·행간격 145·필드간격 269 = baked와 동일. 단 **홀딩박스가 칸에서 181px**(baked 156, 25px 차), **주사위 타일 ~80px**(baked 셀크기 상수 96). 창은 프레임마다 위치만 다름(드래그).

**(c) 블롭 검출이 위치 견고** — 각 칸/홀딩 영역에서 밝은 ~80px 타일의 bbox 중심을 찾으면 **69개 주사위 전부 정확 검출**. ⇒ 박스 보정이 픽셀단위로 완벽하지 않아도(±반칸) 견고하고, 빈칸은 블롭없음으로 판정.

**(d) 기존 템플릿(02 박제)은 계통오류** — 실캡처에서 값을 1 낮게 읽음(3→2, 4→3, 5→4). 02가 80px가 아닌 비대표 렌더라서. **해결 검증됨:** 실캡처 5장+정답으로 템플릿 재제작 → **leave-one-out 교차검증 95.7%(66/69)**, 잔여 오류 5→4 3건뿐.

**결론:** 인식 코어 로직은 정상이나, **(1) 위치=박스 보정 (2) 검출=블롭 (3) 값=실캡처 템플릿 재제작** 세 가지가 함께 필요. per-user 템플릿 부트스트랩은 96%↑·타해상도용 **향후**(§9).

## 1. 목표 / 범위
- **수동 박스 보정**으로 boardRect를 1회 확정·저장 + **블롭검출 인식** + **실캡처 재제작 템플릿** → 회원 해상도에서 스냅샷 인식이 ~96%로 동작.
- **솔버/엔진/입력 UI·자동적용 정책 불변.** Plan 2 파이프라인(`capture→worker→recognize→toBoardState→scanGate→applyScan`) 재사용. 변경 지점: `findAnchor`→보정 rect, `recognize`의 칸/홀딩 분류를 블롭검출 기반으로, 템플릿 재제작. `toBoardState`/`scanGate`/`applyScan` 인터페이스 불변.

### 1.1 북극성(최종 목표)과의 관계
사용자 최종 목표: **화면 공유 버튼 하나 → 현재 필드 자동 스캔·배치 → 내 턴에 주사위 굴리면 자동 계산·추천**(무조작 연속 자동).
- 자동 위치찾기는 실측상 신뢰 불가 → **위치는 최초 1회 박스 보정**으로 해결(저장·영구 재사용; 창 이동 시에만 재보정). 최초 세팅 후 경험은 "버튼 하나 → 자동"과 동일.
- 본 증분(Tier2 보정)은 그 토대다. **연속 자동 루프**(아래 §9 범위 밖)는 보정된 rect 위에 얹는 다음 증분이며, 본 증분의 스냅샷 스캔에서 **실브라우저 인식 ms**를 측정해 그 타당성을 판단한다(부모 스펙 위험 ①).

## 2. 보정 UX — 거친 박스 + 격자 오버레이 미세조정
- **화면 연결** 시 저장된 rect가 없으면(또는 **재보정** 버튼) **보정 패널**을 연다.
- 보정 패널:
  - 캡처한 **정지 프레임**을 캔버스에 폭맞춤 표시(표시 배율 = 캔버스폭/프레임폭). "프레임 새로고침"으로 깨끗한 정지화면 재취득.
  - 그 위에 **격자 오버레이**: 현재 boardRect에서 산출한 **18칸 점 + 좌/우 홀딩박스 표식**을 그림. 시작 추정 rect = baked BOARD_REF 위치(없으면 프레임 중앙 기본).
  - 조작: **격자 내부 드래그 = 이동(translate)**, **모서리/변 핸들 드래그 = 크기조절(scale)**. 회전 없음. 드래그 중 점이 실시간 갱신되어 주사위/슬롯에 얹히는지 즉시 확인.
  - **확인** → rect 저장·패널 닫기. **취소** → 변경 폐기.
- 좌표계: 보정은 **표시 좌표**로 조작하되 저장·인식은 **프레임 픽셀 좌표**로 환산(표시배율 역산). 따라서 캔버스 표시 크기와 무관하게 일관.

## 2.1 UI 정리 (이 증분에 포함)
현재 툴바가 스캔 버튼 4개(연결/스캔/연결끊기/디버그)+옵션 5개로 난잡 → 정리한다.

**화면 공유 = 단일 토글 + 스캔 동작:**
- 연결 전: `[🖥️ 화면 공유]` (클릭 → getDisplayMedia; 저장 rect 없으면 보정 패널 자동 오픈).
- 연결 후: `[📷 스캔]` `[⏹ 공유 중지]` + 작은 `[📐 재보정]`. 상태 텍스트 인라인.
- `💾 디버그: 프레임 저장` 버튼은 **최종 UI에서 제거**(진단용 임시였음).
- **스캔 버튼은 한시적**: 다음 증분(연속 자동 루프)에서 자동 스캔으로 대체되어 제거되고, 토글 하나만 남는다(§1.1·§9 북극성). 본 증분 구조는 그 수렴을 막지 않게 설계(스캔 트리거만 수동→자동 교체).

**보드 툴바:** `되돌리기`·`전체 비우기` 유지.

**옵션 정리(5→접이식):** `보너스 주사위`(보드 직접 관련)만 인라인 유지. 나머지 4개(`내 밑장빼기`·`상대 밑장빼기`·`정밀 모드`·`무지성 상대`)는 `⚙️ 옵션 ▾` 접이식에 넣어 **기본 접힘**(펼침 상태는 localStorage 기억). 평소 체크박스 1개만 노출.

본 정리는 **표시/배치만** 바꾸며 기존 옵션의 동작·바인딩(`bonusMode`/`myMitjang`/`oppMitjang`/`precise`/`realAI`)·솔버는 불변.

## 3. 데이터 흐름 / 저장
```
[화면 연결] → 1프레임 grab
   localStorage rect 있음 & 캡처 dims 일치 → 스캔 준비
   없음/불일치 → 보정 패널
[보정] 캔버스(정지프레임)+격자 오버레이 → 드래그(이동/리사이즈) → 확인
   → localStorage['tikatuka.boardRect'] = { x, y, w, h, capW, capH }   // 프레임 픽셀 좌표
[스캔] grab frame → worker.postMessage({ buffer, width, height, boardRect })
   → recognizeFrame(frame, boardRect)          // boardRect 주면 findAnchor 생략
   → toBoardState → scanGate → applyScan        // Plan 2 그대로
[재보정] 버튼 → 보정 패널 재오픈
```
- 저장은 **단일 rect**(+ 보정 당시 capW×capH). 다음 연결의 캡처 dims가 다르면(해상도/창크기 변경) **경고 + 재보정 권유**(자동 사용 안 함).

## 4. 모듈 변경
| 모듈 | 변경 |
|---|---|
| `src/vision/blob.js` (신규·순수) | `findDieBlob(gray, cx, cy, half, opts) -> {cx,cy}\|null` — (cx,cy)±half 영역에서 임계(≈165) 이상 밝은 4-연결 최대 블롭의 bbox 중심. die-크기(55~110px, 정사각 근사) 아니면 null. 빈칸=null. (검증된 알고리즘.) |
| `src/vision/recognize.js` | (1) `recognizeFrame(frame, boardRect = null)` — `boardRect` 주면 `findAnchor`/`anchorToBoardRect` 생략(기본 null=기존 동작 불변). (2) **칸·홀딩 분류를 블롭검출 기반으로**: 각 칸은 `findDieBlob`로 주사위 중심을 찾아 그 중심에서 템플릿 분류, 블롭없음=빈칸. 홀딩도 영역내 블롭 검출 → `isMyTurn`/`rolledDie`. (고정점 샘플링 대체.) |
| `src/vision/vision-worker.js` | 메시지에서 선택적 `boardRect` 받아 `recognizeFrame(frame, boardRect)`로 전달. |
| `src/vision/layout.js` | 셀크기 상수 **96→80**(실드 링·클립 판정용; 분류는 TPL_SIZE 70 무관). 홀딩박스 위치는 영역검색(±half)으로 견고하므로 분수는 대략값 유지(블롭이 흡수). |
| `src/vision/build-templates.mjs` + `templates-data.js` | **실캡처 5장 + 정답 라벨로 템플릿 재제작.** 빌드 스크립트가 `10~14-live.png`에서 라벨된 칸/홀딩의 블롭중심 패치를 모아 값별 평균 → `templates-data.js` 교체. 라벨은 스크립트에 상수로 기입(§0(d), 메모리 기록값). LOO 95.7% 재현 확인. |
| `src/vision/calibration.js` (신규·순수) | 보정 기하만 담당(**오버레이 점은 `computeLayout(rect)` 재사용**): `handlesOf(rect) -> [{id,x,y}]`(4모서리+4변), `hitTest(pt, rect, tol) -> id\|'inside'\|null`, `applyDrag(rect, target, dx, dy) -> rect'`(이동/리사이즈; 최소크기 클램프), `toFrameRect`/`toDisplayRect`(표시↔프레임 환산). DOM 없음. |
| `app.js`/`index.html`/`styles.css` | 보정 패널(캔버스+오버레이+핸들+새로고침/확인/취소), localStorage load/save, worker에 boardRect 전달. **UI 정리(§2.1)**. 기존 옵션 v-model/솔버 불변. |

`recognize.js`가 boardRect를 받을 때 `clipped`/`inBounds` 판정은 기존대로 유지. 블롭검출은 칸 사각형이 프레임 내일 때만 시도(밖이면 clipped).

## 5. 인식 정확도
- **위치**: 블롭검출이 ±반칸 오차를 흡수 → 보정이 픽셀단위로 완벽하지 않아도 됨.
- **값**: 실캡처 재제작 템플릿으로 LOO 95.7%. 잔여 오류는 5↔4(가장 닮은 쌍).
- 잔여 ~4%·5↔4는 `scanGate` 저신뢰 표시 + 기존 수동수정으로 흡수(Plan 2 그대로). 완전 자동(무수정)은 per-user 부트스트랩 등 향후(§9).

## 6. 에러 / 엣지
- 저장 rect 없음 → 첫 스캔 전 보정 강제(안내).
- 캡처 dims ≠ 저장 capW×capH → "해상도/창 크기가 달라요 — 재보정 필요" 경고, 저장 rect 미사용.
- 보정 후에도 저신뢰/갭/잘림 → 기존 `scanGate` 보류 + 라인 강조가 처리(Plan 2 그대로).
- 검은 프레임/권한거부/스트림종료 → Plan 2 처리 그대로.

## 7. 테스트
- **`blob.js`(순수) → `node --test`**: 라이브 프레임에서 알려진 주사위 중심 ±오차 위치로 `findDieBlob` 호출 → 실제 주사위 중심(±몇 px) 반환; 빈 영역 → null.
- **`recognize.js` 정확도 → `node --test`**: 5장 라이브(`10~14-live.png`)를 각 프레임 boardRect로 `recognizeFrame` → 사용자 정답과 대조해 **칸 정확도 ≥ 90%**(목표 ~96%) 단언, 그리고 프레임10은 전칸 정확(roll6/내L1=4/상대L2=4). `boardRect=null`이면 기존 동작 불변(회귀). 프레임별 boardRect·정답은 테스트에 상수로 기입(메모리 기록값).
- **`templates.test.js`(갱신)**: 재제작 TEMPLATES 0~6 존재·구별. 1(씨앗)≠2 등.
- **`calibration.js`(순수)**: `applyDrag`/`hitTest`/`handlesOf`/`toFrameRect`·`toDisplayRect` 왕복.
- 보정 패널(캔버스/드래그/저장)·워커 = **실브라우저 수동**. 수동 검증 시 **인식 ms 기록**(연속 루프 GO/NO-GO).
- 빌드 게이트: 기존 전체 스위트 + 신규 전부 그린(fail 0). 픽스처 로컬 전용(.gitignore); `10~14-live.png`. **주의**: V6 등 기존 02-기반 값 테스트는 재제작 템플릿으로 값이 바뀔 수 있음 → 라이브 기반 테스트로 갱신/대체(02는 비대표).

## 8. 빌드 순서(리스크 우선)
1. `blob.js`(순수 블롭검출) + 테스트 — 검출 토대.
2. `build-templates.mjs` 재제작 + `templates-data.js` 교체 + `templates.test.js` 갱신 — **값 정확도 확정**(핵심 리스크).
3. `layout.js` 셀크기 80.
4. `recognize.js` `boardRect` 인자 + 블롭검출 분류 + **5장 라이브 정확도 테스트(≥90%)** — 인식이 보정 rect+재제작 템플릿으로 동작 확정.
5. `vision-worker.js` boardRect 전달.
6. `calibration.js`(순수 기하) + 테스트.
7. `app.js`/`index.html`/`styles.css` 보정 패널·저장·재보정 결선 + **UI 정리(§2.1)** — 실브라우저 수동(인식 ms 측정).

## 9. 범위 밖 / 향후 (북극성)
- **연속 자동 루프**(다음 증분): 보정 rect 위에서 화면을 주기적으로 보다가 ① 내 턴(홀딩박스 주사위) 감지 → 자동 스캔·배치 ② 굴린 주사위 인식 → 자동 계산·추천. = "버튼 하나 → 전부 자동". 본 증분의 ms 측정으로 GO/NO-GO.
- 창 이동 자동추적(사용자 랜드마크 매칭). **per-user 템플릿 부트스트랩**(수정→템플릿 학습): 96%↑ 및 **타 해상도 대응**(재제작 템플릿은 ~80px 스케일 특화라 다른 해상도에선 부정확 가능 → 부트스트랩 또는 패치 스케일정규화 필요). 다른 해상도 자동감지.
