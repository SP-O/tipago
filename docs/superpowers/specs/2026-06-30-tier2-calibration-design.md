# Tier2 박스 드래그 보정(수동 위치지정) 설계 — 티파고

작성 2026-06-30. 부모 설계: [`2026-06-29-screen-recognition-design.md`](2026-06-29-screen-recognition-design.md), [`2026-06-30-screen-recognition-ui-design.md`](2026-06-30-screen-recognition-ui-design.md).
선행: Plan 2(스냅샷+Tier1)는 브랜치 `feat/screen-recognition-ui`에 구현 완료(7태스크, 109 테스트, opus MERGE-READY)됐으나 **실브라우저 스모크에서 Tier1 자동앵커가 실패**. 이 문서는 그 원인을 해결하는 보정 증분이다.

## 0. 배경 — 진단 결과 (이 설계의 근거)
실제 `getDisplayMedia` 캡처(`vision-fixtures/10-live-capture.png`, 2560×1440)로 검증한 사실:
- 회원이 예전 제공한 학습 픽스처(01·02…)는 **실제 화면공유 캡처와 다르게 프레임**돼 있었다 → baked 앵커/레이아웃 기준이 비대표적.
- 라이브 캡처에서 앵커 일치도 perPixel≈22(나쁨; 02는 0)로 **false match**(scale 0.6, y 510). 보드를 못 잡아 홀딩박스가 어두운 곳을 봐 `isMyTurn=false`.
- **그러나 실제 보드는 거의 scale 1.0**, 위치만 오프셋(~−33,+50). 주사위 ~78px ≈ baked TPL 70px.
- **검증 완료(스파이크):** 올바른 boardRect `{x:791,y:581,w:979,h:434}`를 `computeLayout`에 주면 → `isMyTurn=true`, 내 L1=4, 상대 L2=4 정확. 굴린 주사위는 정확한 중심(708,800)에서 **value=6, conf 0.95**.

**결론:** 인식 코어·기존 템플릿은 정상. 망가진 것은 **자동 위치찾기(앵커)뿐**. 사용자가 boardRect만 정확히 지정하면 기존 템플릿으로 동작한다. ⇒ **per-user 템플릿 재제작 불필요**(부모 스펙의 우려 해소).

## 1. 목표 / 범위
- **수동 박스 보정**으로 boardRect를 1회 확정·저장 → 이후 스캔은 저장 rect 재사용. 회원 해상도에서 스냅샷 인식이 실제로 동작하게 만든다.
- **솔버/엔진/인식 코어 불변.** Plan 2 파이프라인(`capture→worker→recognize→toBoardState→scanGate→applyScan`) 재사용; `findAnchor`가 주던 boardRect만 보정 rect로 대체.

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

## 4. 모듈 변경 (작은 추가, 하위호환)
| 모듈 | 변경 |
|---|---|
| `src/vision/recognize.js` | `recognizeFrame(frame, boardRect = null)` — `boardRect` 주면 `findAnchor`/`anchorToBoardRect` 생략하고 직접 사용. **기본 null = 기존 동작 불변**(Plan 2 테스트 유지). |
| `src/vision/vision-worker.js` | 메시지에서 선택적 `boardRect` 받아 `recognizeFrame(frame, boardRect)`로 전달. |
| `src/vision/layout.js` | **홀딩박스 분수 미세튜닝** — 진단의 23px 어긋남(굴린주사위 오인식 원인) 보정. `holdMine`/`holdOpp` 분수를 라이브 캡처(708,800) + 02 양쪽에서 검증. (값은 추정치였음 — 부모 코어 forward concern.) |
| `src/vision/calibration.js` (신규·순수) | 보정 기하만 담당(**오버레이 점은 기존 `computeLayout(rect)` 재사용 — 재구현 금지**): `handlesOf(rect) -> [{id,x,y}]`(4모서리+4변 핸들), `hitTest(pt, rect, tol) -> handleId\|'inside'\|null`, `applyDrag(rect, target, dx, dy) -> rect'`(target='inside'면 이동, 핸들이면 리사이즈; 최소 크기 클램프), `toFrameRect(displayRect, scale)`/`toDisplayRect(frameRect, scale)`(표시↔프레임 좌표 환산). **DOM 없음**. 오버레이 렌더는 app 측에서 `computeLayout(rect)`의 cells/holdMine/holdOpp 점을 그린다. |
| `app.js`/`index.html`/`styles.css` | 보정 패널(캔버스 + 오버레이 캔버스/SVG + 핸들 + 새로고침/확인/취소), 재보정 버튼, localStorage load/save, worker에 boardRect 전달. |

`recognize.js`가 boardRect를 받을 때 `clipped`/`inBounds` 판정은 기존대로 유지.

## 5. 보정 정확도 & 굴린 주사위
- 진단상 boardRect만 맞으면 칸 값은 정확(내·상대 라인 conf 0.2~0.3). 굴린 주사위는 홀딩박스 분수 튜닝(§4 layout.js) 후 정확(conf 0.95 @ 정확중심).
- 보정 점이 주사위 중심에서 다소 빗나가도, 칸은 빈칸 밝기/템플릿으로 견고; 다만 **정확히 얹을수록 conf↑**. 오버레이 실시간 피드백으로 사용자가 정렬.

## 6. 에러 / 엣지
- 저장 rect 없음 → 첫 스캔 전 보정 강제(안내).
- 캡처 dims ≠ 저장 capW×capH → "해상도/창 크기가 달라요 — 재보정 필요" 경고, 저장 rect 미사용.
- 보정 후에도 저신뢰/갭/잘림 → 기존 `scanGate` 보류 + 라인 강조가 처리(Plan 2 그대로).
- 검은 프레임/권한거부/스트림종료 → Plan 2 처리 그대로.

## 7. 테스트
- **`calibration.js`(순수) → `node --test`**: `applyDrag`(이동/리사이즈/최소크기 클램프), `hitTest`(핸들/내부/바깥), `handlesOf`(rect→8핸들 좌표), `toFrameRect`/`toDisplayRect` 좌표 환산 왕복. (오버레이 점 자체는 `computeLayout`이 이미 테스트됨.)
- **`recognize.js` boardRect 경로 → `node --test`**: `10-live-capture.png`에 `recognizeFrame(img, {x:791,y:581,w:979,h:434})` → `isMyTurn=true`, 내 L1 packed=[4], 상대 L2 packed=[4], (홀딩분수 튜닝 후) `rolledDie=6`. **boardRect=null이면 기존 동작 불변**(회귀).
- **`layout.js` 홀딩분수 튜닝 → `node --test`**: 02에서 `holdMine` 밝기>120 유지 + 라이브에서 홀딩 중심이 (708±a, 800±a)에 들어 `rolledDie=6`.
- 보정 패널(캔버스/드래그/저장) = **실브라우저 수동**. 수동 검증 시 **인식 ms 기록**(연속 루프 타당성 근거).
- 빌드 게이트: 기존 전체 스위트 + 신규 전부 그린(fail 0). 픽스처는 로컬 전용(.gitignore); `10-live-capture.png` 포함.

## 8. 빌드 순서(리스크 우선)
1. `layout.js` 홀딩박스 분수 튜닝 + 테스트(02·라이브) — 굴린주사위 정확도 확정.
2. `recognize.js` `boardRect` 인자(하위호환) + 라이브 캡처 테스트 — **인식이 보정 rect로 된다는 계약 확정**.
3. `vision-worker.js` boardRect 전달.
4. `calibration.js`(순수 기하) + 테스트.
5. `app.js`/`index.html`/`styles.css` 보정 패널·저장·재보정 결선 — 실브라우저 수동(인식 ms 측정).

## 9. 범위 밖 / 향후 (북극성)
- **연속 자동 루프**(다음 증분): 보정 rect 위에서 화면을 주기적으로 보다가 ① 내 턴(홀딩박스 주사위) 감지 → 자동 스캔·배치 ② 굴린 주사위 인식 → 자동 계산·추천. = "버튼 하나 → 전부 자동". 본 증분의 ms 측정으로 GO/NO-GO.
- 창 이동 자동추적(사용자 랜드마크 매칭). per-user 템플릿(불필요 확인됨). 다른 해상도 자동감지.
