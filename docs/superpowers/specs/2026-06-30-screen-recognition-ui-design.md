# 화면 인식 UI 결선(Plan 2 · 스냅샷 + Tier1) 설계 — 티파고

작성 2026-06-30. 부모 설계: [`2026-06-29-screen-recognition-design.md`](2026-06-29-screen-recognition-design.md).
인식 코어(Plan 1: `src/vision/` image/anchor/layout/templates/recognize/adapter)는 main에 병합·배포 완료(커밋 `b00beee`, 97 테스트). 이 문서는 그 코어를 **실제 브라우저 UI에 결선**하는 첫 증분의 설계다.

## 0. 이 증분의 범위 (사용자 승인)
- **스냅샷 반자동**: "스캔" 버튼을 누른 그 순간 **1프레임만** 캡처·인식. 연속 자동 루프는 다음 증분(단, 워커 기반은 이번에 선설치).
- **Tier1 자동 인식만**: 사용자가 게임을 **전체화면/기준 해상도**로 플레이한다는 가정. 인식 실패(다른 해상도 포함)는 **기존 수동 입력 UI로 폴백**. Tier2 박스 드래그 보정·per-user 부트스트랩은 다음 증분.
- **솔버/엔진/기존 UI 불변** — 인식은 "또 하나의 입력 방식"으로 추가만 한다(부모 §1).

### 범위 밖 (다음 증분)
연속 자동 루프(변화감지·디바운스·애니메이션 게이팅), Tier2 박스 드래그 보정, per-user 템플릿 부트스트랩, 행3(내 L3·상대 L3) 정밀도 보정.

## 1. 아키텍처 — 모듈 경계
인식·판정 로직은 전부 **순수 모듈**에 두고, Vue reactivity·DOM·worker 메시징만 결합부에 격리한다(부모 §3 원칙 계승). 신규 4개:

| 모듈 | 성격 | 책임 |
|---|---|---|
| `src/vision/capture.js` | **브라우저 전용**(유일 결합부) | `connect()` → `getDisplayMedia({video})` 픽(세션 1회). `grabFrame()` → 라이브 `<video>` 현재 프레임을 OffscreenCanvas/canvas에 그려 `getImageData` → frame `{ data:Uint8ClampedArray(RGBA), width, height }`(부모 §3 frame 계약). `disconnect()` → 트랙 정지. `isBlackFrame(frame)` → 전체 평균 밝기 ~0 감지(**순수, node-testable**). |
| `src/vision/vision-worker.js` | Web Worker(`type:'module'`) | `onmessage`: transfer된 `ArrayBuffer`+`{width,height}` → frame 재구성 → `recognizeFrame(frame)` → `toBoardState(rec)` → `postMessage({ board, ms })`. 솔버 `worker.js`와 **별개 워커**. |
| `src/vision/st-writer.js` | **순수**(node-testable) | `boardStateToSt(b)` → `{ me:[[{value,shield}]x3], opp:[...], die:number, bonusMode:bool }` 평면 객체(reactive `st`에 그대로 대입 가능한 형태). `scanGate(b)` → `{ ok, reasons:[...], clipped, isMyTurn, lines:{ me:[{lowConf,impossible}x3], opp:[...] } }`. 부수효과 0. |
| `app.js`(기존, 최소 추가) | Vue 결선 | 스캔 버튼 핸들러 + 워커 인스턴스. 결과 수신 시 `pushHistory()` → reactive `st`/`die`/`ui.bonusMode` 일괄 기록 → `scanGate.ok`면 `solve()`, 아니면 `ui.scanFlags` 설정해 저신뢰/갭/잘림 칸 강조 후 수동 대기. |

`index.html`은 스캔 버튼·상태줄을 추가하고 처음으로 `src/vision/`을 참조한다(지금까지 코어는 라이브와 격리돼 있었음 — 이 결선이 기능을 활성화).

### 1.1 Tier1 앵커 속도 최적화 (부모 §15 위험 ① 완화)
Tier1은 전체화면/기준 해상도 가정이므로 배율이 1 부근이다. `findAnchor(gray, landmark)`에 **선택적 scale 범위 인자**를 추가해 워커는 좁은 범위(예 `[0.95, 1.05]`)로 호출 → 멀티스케일 SAD 비용 대폭 절감(Plan 1 측정 ~1.5s/콜 → 단축). **기본 인자는 기존 범위**라 Plan 1 테스트·동작 불변(하위호환).

## 2. 데이터 흐름
```
[화면 연결] (1회, 사용자 제스처):
   capture.connect() → getDisplayMedia("창→로스트아크") → 라이브 스트림 유지

[스캔] 클릭 (내 턴마다 반복):
   capture.grabFrame() → frame {data,width,height}
    → worker.postMessage(frame.data.buffer 를 transfer) 
    → [vision-worker] recognizeFrame → toBoardState → { board, ms }
    → app: pushHistory()
           st/die/ui.bonusMode ← boardStateToSt(board)        // 화면에 즉시 반영(되돌리기 보존)
           gate = scanGate(board)
           gate.ok ? solve()                                   // 내턴·고신뢰·갭정상·미잘림
                   : ui.scanFlags = {저신뢰/갭/잘림}, 자동계산 보류
```
- 첫 캡처만 창 선택(자동 불가). 이후 "스캔"은 **같은 스트림에서 새 프레임만** 잡는다(재선택 없음).
- `frame.data.buffer`는 워커로 **transfer(zero-copy)**. 매 스캔마다 새 `getImageData`라 메인 측 버퍼 소실은 무해.

## 3. 비인식 입력 / 자동 적용 정책 (부모 §9 계승, 스냅샷 적용)
- **인식 불가 입력은 수동 유지**: `myMitjang`/`oppMitjang`/`precise`/`realAI`는 보드에 없음 → 토글 그대로, 자동계산은 현재 수동값 사용(부모 §9). 밑장빼기는 종반 답을 바꾸므로 사용자 책임.
- **일괄 기록은 반드시 `pushHistory()` 경유** → 되돌리기 유지. 한 번의 스캔 = 하나의 undo 단위.
- **`scanGate.ok` 조건**: `isMyTurn && !clipped && !anyImpossible && !anyLowConf`. (`toBoardState`가 이미 `clipped`/`anyImpossible`/`anyLowConf`/`isMyTurn` 제공.) 충족 시에만 `solve()` 자동 실행.
- **보류 시**: 보드는 채워 보여주되(사용자가 눈으로 확인), 자동계산은 멈춘다. 강조는 **라인 단위**(어느 라인이 저신뢰/갭/잘림인지)로 한다 — packed 변환 후엔 칸별 conf가 사라지므로 칸 단위 강조는 하지 않는다(개별 칸 정밀화는 다음 증분). 사용자가 기존 칸 UI로 수정하면(이미 `pushHistory` 경유) 평소대로 동작.
- **`toBoardState` 최소 확장(추가·하위호환)**: 현재 보드 단위 `anyLowConf`/`anyImpossible`만 노출하므로, **라인 단위** `minConf`/`impossible`을 반환 객체에 추가한다(`scanGate`의 라인 강조 입력). 기존 필드·동작 불변, 테스트 보강.
- `solve()`는 `!die.value`면 조기반환(app.js) → 자동계산 전에 `die` 먼저 기록.

## 4. 에러 / 엣지 (Tier1 한계 정직화)
| 상황 | 처리 |
|---|---|
| getDisplayMedia 거부/취소 | 안내, 수동 입력 유지 |
| 검은 프레임(전체화면 독점) | "테두리없는 창모드로 바꿔주세요" 안내, 미기록(`isBlackFrame`) |
| 앵커 실패(perPixel>임계) / 갭이상 / 잘림 / 저신뢰 | 자동적용 보류. **다른 해상도면 인식 실패** → "보드를 못 찾았어요 — 다른 해상도 지원은 다음 업데이트(박스 보정) 예정" + 수동 안내 *(Tier2가 메울 지점)* |
| 내 턴 아님(홀딩박스 빔, `isMyTurn=false`) | "굴린 주사위가 없어요(내 턴 아님)" → `die` 미기록 |
| 스트림 종료(공유 중지) | 스캔 비활성 + 안내 |
| getDisplayMedia 미지원(모바일/구브라우저) | 스캔 기능 숨김/비활성 + 안내(데스크톱 크롬·엣지·HTTPS 필요) |

## 5. 테스트 전략
- **`st-writer.js`(순수) → `node --test`**: `02-midgame-shields.png`를 `recognizeFrame`→`toBoardState`한 **실결과**로 (a) `boardStateToSt` 매핑이 `st.me/opp`·`die`·`bonusMode`로 정확히 변환되는지, (b) `scanGate`가 정상 보드=ok, 잘림(`07-after-3`)/상대턴(`08`)=보류로 판정하는지 단언.
- **`capture.isBlackFrame`(순수) → `node --test`**: 합성 검은/정상 프레임.
- **`findAnchor` 좁은 scale 범위**: 02/07 픽스처에서 정확성 유지 단언(속도는 브라우저 실측).
- `recognizeFrame`/`toBoardState`: Plan 1에서 이미 픽스처 테스트됨(회귀 유지).
- **capture getDisplayMedia + 워커 글루 = 실브라우저 수동 테스트**(node 불가). Playwright 스모크(스텁 스트림으로 스캔 버튼 결선 확인)는 후순위.
- **빌드 게이트**: 기존 전체 스위트 + 신규 순수 테스트 전부 그린(fail 0). 픽스처는 로컬 전용(.gitignore) — 깨끗한 CI에선 vision 테스트가 픽스처 부재로 실패하는 게 정상(부모 코어 리뷰 후속).

## 6. 통합 시 적용할 코어 후속 (Plan 1 opus 리뷰 지적, 비차단)
결선하면서 함께 처리:
- `recognize.js` holdMine 턴/rolledDie 샘플링에 `isCellClipped` 가드 추가(현재 NaN으로 fail-safe만 — 가드로 명시).
- `adapter.js`의 `anyLowConf`가 NaN conf를 놓침 → `!(minConf >= CONF_MIN)`로 수정(NaN도 저신뢰로 취급).

## 7. 가장 위험한 미지수(이 증분) & 검증 방법
1. **실브라우저 인식 지연** — 스냅샷이 측정 출력(`ms`)을 회신 → 연속 루프(다음 증분) GO/NO-GO 근거. Tier1 scale 좁힘으로 1차 완화.
2. **창 캡처 frame 형태가 Node 디코드와 동일한가** — frame 계약(부모 §3) 가정. 실브라우저 첫 스캔에서 검증.
3. **앵커가 실제 전체화면 기준 해상도에서 동작** — 픽스처(2560 기준)는 통과, 실사용 해상도에서 수동 확인 필요.

## 8. 빌드 순서(리스크 우선)
1. `toBoardState` 라인 단위 `minConf`/`impossible` 추가(§3, 하위호환) + 테스트 보강 — 계약 확정.
2. 순수 `st-writer.js`(boardStateToSt/scanGate) + 테스트 — 저위험, 계약 확정.
3. `findAnchor` scale 범위 인자(하위호환) + 테스트.
4. 코어 후속(§6) 가드 2건 + 회귀.
5. `capture.js`(connect/grabFrame/disconnect/isBlackFrame) — isBlackFrame만 단위테스트, 나머지 수동.
6. `vision-worker.js` + app.js/index.html 결선(스캔 버튼·상태·라인 강조) — 실브라우저 수동 검증(지연 ms·frame 계약·앵커).
7. 정직한 한계 안내(다른 해상도→다음 업데이트) 문구.
