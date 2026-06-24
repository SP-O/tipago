import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dieIndexToCell, cellToDieIndex, nextFillCell } from '../src/ui-layout.js';

test('me: 먼저 놓인 주사위가 오른쪽(cell2)부터 채워짐', () => {
  assert.equal(dieIndexToCell('me', 0), 2);
  assert.equal(dieIndexToCell('me', 1), 1);
  assert.equal(dieIndexToCell('me', 2), 0);
  assert.equal(nextFillCell('me', 0), 2);
  assert.equal(nextFillCell('me', 2), 0);
  assert.equal(nextFillCell('me', 3), -1);
});

test('opp: 먼저 놓인 주사위가 왼쪽(cell0)부터 채워짐', () => {
  assert.equal(dieIndexToCell('opp', 0), 0);
  assert.equal(dieIndexToCell('opp', 2), 2);
  assert.equal(nextFillCell('opp', 0), 0);
  assert.equal(nextFillCell('opp', 2), 2);
  assert.equal(nextFillCell('opp', 3), -1);
});

test('cellToDieIndex me: 오른쪽 정렬, 빈칸은 -1', () => {
  // k=2 → 채워진 칸은 오른쪽 두 칸(cell1,2)
  assert.equal(cellToDieIndex('me', 2, 0), -1);
  assert.equal(cellToDieIndex('me', 2, 1), 1); // 두 번째 놓인 주사위
  assert.equal(cellToDieIndex('me', 2, 2), 0); // 먼저 놓인 주사위(맨 오른쪽)
});

test('cellToDieIndex opp: 왼쪽 정렬, 빈칸은 -1', () => {
  // k=2 → 채워진 칸은 왼쪽 두 칸(cell0,1)
  assert.equal(cellToDieIndex('opp', 2, 0), 0);
  assert.equal(cellToDieIndex('opp', 2, 1), 1);
  assert.equal(cellToDieIndex('opp', 2, 2), -1);
});

test('round-trip: dieIndexToCell ↔ cellToDieIndex 일관성', () => {
  for (const side of ['me', 'opp']) {
    for (let k = 1; k <= 3; k++) {
      for (let di = 0; di < k; di++) {
        const cell = dieIndexToCell(side, di);
        assert.equal(cellToDieIndex(side, k, cell), di, `${side} k=${k} di=${di}`);
      }
    }
  }
});
