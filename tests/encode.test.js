import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { encode, INPUT_SIZE } from '../src/solver/encode.js';

const D = (value, shield = false) => ({ value, shield });

test('encode: 길이 75, 빈 보드 기본값', () => {
  const f = encode(createState());
  assert.equal(f.length, INPUT_SIZE);
  assert.equal(f.length, 75);
  // 라인 특징 72개는 모두 0
  for (let i = 0; i < 72; i++) assert.equal(f[i], 0);
  assert.equal(f[72], 1); // turn = me
  assert.equal(f[73], 1); // me.hasMitjang
  assert.equal(f[74], 0); // opp.hasMitjang
});

test('encode: 비실드/실드 개수를 값별로 분리', () => {
  const s = createState();
  s.me.lines[0] = [D(5, false), D(5, true)]; // 비실드 5 한 개, 실드 5 한 개
  const f = encode(s);
  // 라인0(me) = 인덱스 0..11: 비실드[0..5], 실드[6..11]
  assert.equal(f[4], 1);  // 비실드 값5 (인덱스 5-1=4)
  assert.equal(f[10], 1); // 실드 값5 (인덱스 6 + 4 = 10)
  // 다른 라인 특징은 0
  for (let i = 12; i < 72; i++) assert.equal(f[i], 0);
});

test('encode: opp.hasMitjang 반영', () => {
  const f = encode(createState({ oppHasMitjang: true }));
  assert.equal(f[74], 1);
});
