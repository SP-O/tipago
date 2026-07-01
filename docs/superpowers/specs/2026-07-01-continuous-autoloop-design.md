# 연속 자동 루프 (북극성) — 설계

2026-07-01. 화면공유 중 **내 턴에 주사위를 굴리면 자동으로 인식→보드 입력→추천 계산**. 수동 "스캔" 버튼 누름을 없애고, 오작동 대비 수동 폴백만 남긴다. Tier2(박스 보정 + 실캡처 템플릿, main `9f80966`) 위에 얹는 증분.

## 목표 / 비목표

- **목표:** 내 턴마다 손 안 대고 최적수 추천. 인식 21ms 실측 → 인터벌 폴링으로 충분.
- **비목표:** 상대 턴 자동화, per-user 부트스트랩, UI 대개편. UI는 최소 변경(정말 필요한 기능만).

## 접근 (A: 인터벌 폴링 + 기존 워커 재사용)

~300ms `setInterval`로 프레임 캡처 → 기존 `visionWorker` 인식 → **결정 로직**으로 걸러 새 상태일 때만 기존 `applyScan`(=보드 대입 + `solve()`) 호출. 검증된 조각(`recognizeFrame`/`toBoardState`/`scanGate`/`applyScan`) 재사용, 신규 코드는 "결정 로직" 순수 모듈 하나뿐.

## 핵심 결정 규칙 (순수 모듈 `src/vision/autoloop.js`)

인식 결과 `board`(`toBoardState` 산출: `me/opp/rolledDie/isMyTurn/bonusMode/clipped/anyLowConf/anyImpossible`)와 `gate = scanGate(board)`를 받아 액션 결정:

- **상태 서명** `boardSignature(board)` = `(me 라인 값+실드, opp 라인 값+실드, rolledDie, bonusMode)` 해시. 롤 엣지 감지 + 중복방지를 한 번에 처리.
- **`autoloopStep(state, board, gate)` → action:**
  - `!isMyTurn` → `idle` (상대 턴; 안정화 카운터 리셋, 커밋서명 유지).
  - 서명 == 마지막 커밋서명 → `idle` (같은 상태 재적용 안 함 → 손으로 고친 것도 보호).
  - 안정화: 같은 서명이 **연속 2프레임** 와야 통과(굴림 애니·전환 튀는 프레임 배제). 미달이면 `wait`.
  - 통과했는데 `!gate.ok`(clipped/impossible/lowConf) → `ambiguous` (자동 커밋 보류, 보드 안 건드림).
  - 통과 + `gate.ok` → `commit` (커밋서명 갱신).
- **재롤 처리:** 6 → 상대 턴 → 다시 6이면, 롤 사이 보드가 바뀌어 서명이 달라지므로 항상 재계산.

## 배선 (`app.js`)

- `visionWorker.onmessage` 디스패처화: 진행 중 요청 모드(`inflight`)가 `auto`면 `autoloopStep` 실행(commit→`applyScan`, ambiguous/wait→상태표시만), `manual`이면 기존처럼 `applyScan` 강제 + 커밋서명 동기화.
- `pollAuto()`: 연결·미busy·보정됨·보정창 닫힘일 때만 프레임 캡처(검은화면/캡처실패는 스킵), `inflight='auto'`로 워커 post. `scan.busy`로 중첩 방지(폴링 겹치면 이번 틱 건너뜀).
- 시작: `화면 공유` 연결 + 보정 확정 시 자동 루프 시작(`setInterval`). 중지: `공유 중지`가 루프도 정지.

## UI (최소)

- `화면 공유` → 연결·보정 후 자동 시작. 이후 별도 "시작" 없음(토글 하나 개념).
- `스캔` → **`다시 스캔`**(수동 폴백, 안정화 게이트 건너뜀 즉시 1회). `재보정`, `공유 중지` 유지.
- 상태 배지: `상대 턴 대기 중` / `인식 확인 중...` / `인식 완료(21ms) — 계산함` / `인식 애매(...) — 확인 후 [다시 스캔]`.
- 자동 적용도 `pushHistory()` → 오탐 시 되돌리기.

## 테스트

- 순수 `autoloop.js`는 TDD: 서명 동등/차이, 안정화 2프레임, 커밋 중복방지, ambiguous 보류, 재롤 재계산, 상대턴 idle.
- DOM/캡처 배선은 단위테스트 대상 아님(브라우저 스모크로 검증: 실제 화면공유에서 굴릴 때마다 자동 계산되는지 · 오탐 자동커밋 안 되는지).

## 리스크

- 폴링 캡처(getImageData 2560×1440 ~11MB/틱)의 CPU. 300ms면 허용, 필요시 간격·다운스케일 튜닝(후순위).
- 안정화 2프레임 = 최대 ~수백 ms 지연. 사람 속도엔 무해.
