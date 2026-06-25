import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/solver/evaluate.js';
import { createAzNet, azAdamInit, azTrainBatch } from '../src/solver/az-net.js';
import { AZ_INPUT_SIZE } from '../src/solver/az-encode.js';
import { selfPlayGame } from '../src/solver/az-selfplay.js';

test('self-play: 예제 형식(x 82, v 0/0.5/1, pi 6, mask 6)', () => {
  const net = createAzNet([AZ_INPUT_SIZE, 16], 6, makeRng(1));
  const g = selfPlayGame(net, makeRng(2), { sims: 16, turnCap: 40 });
  assert.ok(g.examples.length > 0);
  for (const e of g.examples) {
    assert.equal(e.x.length, 82);
    assert.ok(e.v === 0 || e.v === 0.5 || e.v === 1);
    assert.equal(e.pi.length, 6);
    assert.equal(e.mask.length, 6);
  }
});

test('학습: self-play 데이터로 azTrainBatch 손실 감소', () => {
  const net = createAzNet([AZ_INPUT_SIZE, 24], 6, makeRng(3));
  const rng = makeRng(4);
  const buffer = [];
  for (let i = 0; i < 4; i++) {
    const g = selfPlayGame(net, rng, { sims: 16, turnCap: 40 });
    for (const e of g.examples) buffer.push(e);
  }
  const adam = azAdamInit(net);
  const batch = buffer.slice(0, Math.min(64, buffer.length));
  const lossStart = azTrainBatch(net, batch, adam, { lr: 0.01 });
  let lossEnd = lossStart;
  for (let s = 0; s < 200; s++) lossEnd = azTrainBatch(net, batch, adam, { lr: 0.01 });
  assert.ok(lossEnd < lossStart, `loss ${lossStart} -> ${lossEnd}`);
});
