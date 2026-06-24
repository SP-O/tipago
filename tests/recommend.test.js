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
