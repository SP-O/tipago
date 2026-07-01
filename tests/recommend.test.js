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

test('recommend: 두 라인이 잠긴 확정승은 100%로 추천(홀드)', () => {
  // 실제 사례. 내 L1 9 vs opp 5(꽉 참) → 홀드로 잠긴 승. die=4를 내 L2에 두면
  // L2 17 vs 9(꽉 참)로 잠김 → 2라인 확보 → 무조건 승. realAI라 MC 경로를 타도 100%여야 함.
  const s = createState({ oppHasMitjang: false });
  s.me.hasMitjang = false;
  s.me.lines = [[D(6), D(3, true)], [D(4), D(5)], [D(5), D(5)]];
  s.opp.lines = [[D(1), D(2, true), D(1)], [D(4, true), D(3), D(2)], [D(4)]];
  const r = recommend(s, 4, { realAI: true, seed: 7 });
  assert.equal(r.best.target.side, 'me');
  assert.equal(r.best.target.lineIndex, 1); // 내 라인 2
  assert.equal(r.best.winProb, 1);
});

test('recommend: 상대가 먼저 꽉 차는 국면에서 전개 수를 저평가하지 않는다(트렁케이션 회귀)', () => {
  // 실제 제보 보드. 내 빈칸5 vs 상대 빈칸2 → 롤아웃이 상대가 먼저 꽉 차면 조기종료해
  // "라인1을 나중에 싸구려로 잠그는" 전개 수(라인2·3)를 과소평가하던 버그.
  // 라인1(18 vs 19, 상대 꽉 참)은 어떤 주사위든 나중에 채워 이기므로, 6을 전개해도 승률이 높아야 한다.
  const s = createState();
  s.me.lines = [[D(6), D(6)], [D(4, true), D(6)], []];
  s.opp.lines = [[D(5, true), D(5, true), D(4)], [D(6, true), D(1)], [D(4, true), D(3)]];
  s.opp.hasMitjang = false; // me.hasMitjang = true (기본)
  const r = recommend(s, 6, { seed: 1234567 });
  const l3 = r.options.find((o) => o.target.lineIndex === 2); // 내 라인3에 전개
  // 버그(조기종료) 상태에선 ~0.59. 판을 끝까지 두면 라인1은 결국 잠기므로 훨씬 높아야 한다.
  assert.ok(l3.winProb > 0.8, `라인3 전개 승률이 저평가됨: ${l3.winProb}`);
});

test('통합: 중반 빈 보드에서 추천이 항상 best를 낸다', () => {
  const s = createState();
  s.me.hasMitjang = false;
  for (let die = 1; die <= 6; die++) {
    const r = recommend(s, die, { seed: die });
    assert.ok(r.best && r.best.winProb >= 0 && r.best.winProb <= 1);
  }
});
