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
